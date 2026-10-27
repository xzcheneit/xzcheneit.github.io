"""Offline regression checks for data integrity; never access live feeds or repo data."""

import importlib.util
import json
from datetime import datetime, timedelta, timezone
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

import httpx


SPEC = importlib.util.spec_from_file_location("feed_build", Path(__file__).resolve().parents[1] / "scripts/build.py")
build = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(build)
NOW = datetime(2026, 10, 27, 3, tzinfo=timezone.utc)


def atom_feed(title="A useful physics result", authors="A. One and B. Two", date="2026-10-26T10:00:00Z"):
    return f'''<?xml version="1.0" encoding="utf-8"?>
    <feed xmlns="http://www.w3.org/2005/Atom">
      <title>Journal</title><id>https://example.org/feed</id><updated>{date}</updated>
      <entry><id>https://example.org/paper</id><title type="html">{title}</title>
        <link href="paper"/><published>{date}</published>
        <author><name>{authors}</name></author><summary>A physics abstract.</summary>
      </entry>
    </feed>'''


class BuildTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.output = Path(self.temporary.name) / "articles.json"
        self.responses = {}
        self.requests = []

        def request(request):
            self.requests.append(str(request.url))
            return self.responses.get(str(request.url), httpx.Response(503, text="Unavailable"))

        self.client = httpx.Client(transport=httpx.MockTransport(request), follow_redirects=True)
        self.addCleanup(self.client.close)
        self.client_patch = patch.object(build, "client", self.client)
        self.client_patch.start()
        self.addCleanup(self.client_patch.stop)
        self.cache_patch = patch.object(build, "_ARX_CACHE", {})
        self.cache_patch.start()
        self.addCleanup(self.cache_patch.stop)
        self.failures_patch = patch.object(build, "_ARX_SEARCH_FAILURES", 0)
        self.failures_patch.start()
        self.addCleanup(self.failures_patch.stop)
        self.save_patch = patch.object(build, "save_arxiv_cache")
        self.save = self.save_patch.start()
        self.addCleanup(self.save_patch.stop)
        self.sleep_patch = patch.object(build.time, "sleep")
        self.sleep_patch.start()
        self.addCleanup(self.sleep_patch.stop)

    def previous_item(self, key="PRL", **overrides):
        return {"journalKey": key, "type": "published", "title": "Previous paper", "authors": ["A. One"],
                "date": "2026-10-26T00:00:00+00:00", "link": "https://example.org/old", "doi": None, **overrides}

    def run_build(self, sources):
        return build.main(sources=sources, output_path=self.output, now=NOW)

    def test_naive_dates_are_utc(self):
        for key in ("published", "dc_date"):
            self.assertEqual(build.parse_date({key: "2026-10-26T10:00:00"}), datetime(2026, 10, 26, 10, tzinfo=timezone.utc))

    def test_relative_article_link_uses_feed_directory(self):
        self.assertEqual(build.canon_link("paper", "https://example.org/journal/feed.xml", None),
                         "https://example.org/journal/paper")

    def test_discovery_handles_attribute_order_quotes_and_relative_links(self):
        url = "https://example.org/journal/index.html"
        self.responses[url] = httpx.Response(200, text="<link href='feed.xml' type='application/rss+xml' rel='alternate'>")
        self.assertEqual(build.discover_feed_from_html(url), "https://example.org/journal/feed.xml")

    def test_discovery_url_can_already_be_a_feed(self):
        url = "https://example.org/rss/current.xml"
        self.responses[url] = httpx.Response(200, text=atom_feed())
        with patch.object(build, "discover_feed_from_html", side_effect=AssertionError("Already a feed")):
            result = self.run_build([{"key": "CPL", "recentDiscover": url}])
        self.assertEqual(result["items"][0]["journalKey"], "CPL")
        self.assertEqual(self.requests.count(url), 1)
        self.assertFalse(any(".xml/rss" in request for request in self.requests))

    def test_non_feed_http_200_reports_meaningful_error(self):
        url = "https://example.org/blocked"
        self.responses[url] = httpx.Response(200, text="<html>Please enable JavaScript</html>")
        _, report = build.fetch_feed_with_report(url)
        self.assertFalse(report["ok"])
        self.assertEqual(report["status"], 200)
        self.assertIn("not a recognized RSS/Atom feed", report["error"])

    def test_empty_valid_feed_reports_meaningful_error(self):
        url = "https://example.org/empty"
        self.responses[url] = httpx.Response(200, text='<feed xmlns="http://www.w3.org/2005/Atom"><title>Empty</title></feed>')
        _, report = build.fetch_feed_with_report(url)
        self.assertFalse(report["ok"])
        self.assertEqual(report["status"], 200)
        self.assertIn("feed contained no entries", report["error"])

    def test_iop_failure_does_not_guess_undeclared_feed_urls(self):
        url = "https://iopscience.iop.org/1367-2630?rss=1"
        self.responses[url] = httpx.Response(200, text="<html>No alternate feed</html>")
        other_url = "https://example.org/feed"
        self.responses[other_url] = httpx.Response(200, text=atom_feed())
        result = self.run_build([{"key": "NJP", "recentDiscover": url}, {"key": "Nature", "recent": other_url}])
        self.assertNotIn("https://iopscience.iop.org/1367-2630/rss", self.requests)
        self.assertFalse(any("?rss=1/rss" in request for request in self.requests))
        self.assertEqual(result["coverage"]["count"], 1)

    def test_normalizes_title_and_aps_authors(self):
        url = "https://example.org/journal/feed.xml"
        self.responses[url] = httpx.Response(200, text=atom_feed(title="&lt;span&gt;Spin &amp;amp; charge&lt;/span&gt;"))
        result = self.run_build([{"key": "PRL", "recent": url}])
        self.assertEqual(result["items"][0]["title"], "Spin & charge")
        self.assertEqual(result["items"][0]["authors"], ["A. One", "B. Two"])
        self.assertEqual(json.loads(self.output.read_text()), result)

    def test_online_first_and_issue_feeds_are_combined_and_deduplicated(self):
        asap = "https://example.org/asap.xml"
        issue = "https://example.org/current.xml"
        self.responses[asap] = httpx.Response(200, text=atom_feed(title="Online first"))
        self.responses[issue] = httpx.Response(200, text=atom_feed(title="Same article in current issue"))
        result = self.run_build([{"key": "NanoLett", "recent": [asap, issue, asap]}])
        self.assertEqual(result["coverage"]["count"], 1)
        self.assertEqual(result["items"][0]["title"], "Online first")
        self.assertEqual(self.requests.count(asap), 1)
        self.assertEqual(self.requests.count(issue), 1)
        reports = [row for row in result["buildReport"]["sources"] if row["key"] == "NanoLett"]
        self.assertEqual(len(reports), 2)
        self.assertTrue(all(row["ok"] for row in reports))
        self.assertTrue(all(row["latestArticleAt"] == "2026-10-26T10:00:00+00:00" for row in reports))

    def test_one_component_feed_failing_preserves_other_recent_articles(self):
        previous = self.previous_item("NanoLett")
        self.output.write_text(json.dumps({"items": [previous]}))
        issue = "https://example.org/current.xml"
        self.responses[issue] = httpx.Response(200, text=atom_feed())
        result = self.run_build([{"key": "NanoLett", "recent": ["https://example.org/asap.xml", issue]}])
        self.assertEqual(result["coverage"]["count"], 2)
        self.assertEqual(result["buildReport"]["retainedItems"], 1)

    def test_feed_refresh_can_skip_optional_arxiv_search_and_keep_positive_cache(self):
        url = "https://example.org/accepted.xml"
        self.responses[url] = httpx.Response(200, text=atom_feed())
        cached = "https://arxiv.org/abs/2610.12345"
        build._ARX_CACHE["a useful physics result"] = cached
        with patch.object(build, "find_arxiv_by_title", side_effect=AssertionError("No optional API calls")):
            result = build.main(sources=[{"key": "PRL", "accepted": url}], output_path=self.output,
                                now=NOW, lookup_arxiv=False)
        self.assertEqual(result["items"][0]["arxiv"], cached)
        self.save.assert_not_called()

    def test_preserves_ambiguous_author_names(self):
        self.assertEqual(build.normalize_authors(["Einstein, Albert"], "PRL"), ["Einstein, Albert"])
        self.assertEqual(build.normalize_authors(["Research and Development Collaboration"], "Nature"),
                         ["Research and Development Collaboration"])

    def test_all_feeds_failing_preserves_previous_output(self):
        original = json.dumps({"items": [self.previous_item()]})
        self.output.write_text(original)
        with self.assertRaisesRegex(RuntimeError, "All feeds failed"):
            self.run_build([{"key": "PRL", "recent": "https://example.org/fails"}])
        self.assertEqual(self.output.read_text(), original)
        self.save.assert_not_called()

    def test_partial_failure_retains_recent_items_only_for_failed_source(self):
        old_items = [self.previous_item(), self.previous_item(link="https://example.org/expired", date="2026-10-01T00:00:00Z"),
                     self.previous_item("Nature", link="https://example.org/stale-successful-source")]
        self.output.write_text(json.dumps({"items": old_items}))
        url = "https://example.org/feed"
        self.responses[url] = httpx.Response(200, text=atom_feed())
        result = self.run_build([{"key": "PRL", "recent": "https://example.org/fails"}, {"key": "Nature", "recent": url}])
        self.assertEqual(result["coverage"]["count"], 2)
        self.assertEqual(result["buildReport"]["retainedItems"], 1)
        self.assertEqual({item["link"] for item in result["items"]}, {"https://example.org/old", "https://example.org/paper"})

    def test_only_failed_arxiv_attempt_does_not_restore_duplicate_old_preprints(self):
        reports = [{"key": "arXivCM", "type": "preprint", "ok": False},
                   {"key": "arXivCM", "type": "preprint", "ok": True}]
        restored = build.retain_failed_source_items([self.previous_item("arXivCM", type="preprint")], reports,
                                                    NOW - timedelta(days=14), set())
        self.assertEqual(restored, [])

    def test_arxiv_search_failure_is_not_cached(self):
        self.assertIsNone(build.find_arxiv_by_title("A useful physics result"))
        self.assertEqual(build._ARX_CACHE, {})

    def test_arxiv_lookup_outage_stops_after_three_failures(self):
        for index in range(10):
            self.assertIsNone(build.find_arxiv_by_title(f"A useful physics result {index}"))
        self.assertEqual(len(self.requests), 3)
        self.assertEqual(build._ARX_CACHE, {})

    def test_empty_arxiv_search_has_expiring_negative_cache(self):
        title = "A useful physics result"
        url = build.ARXIV_SEARCH_BY_TITLE.format(query=build.urllib.parse.quote(f'ti:"{title}"'))
        self.responses[url] = httpx.Response(200, text='<feed xmlns="http://www.w3.org/2005/Atom"><title>Results</title></feed>')
        self.assertIsNone(build.find_arxiv_by_title(title))
        self.assertIn("checkedAt", build._ARX_CACHE[title.lower()])
        requests_before = len(self.requests)
        self.assertIsNone(build.find_arxiv_by_title(title))
        self.assertEqual(len(self.requests), requests_before)

    def test_atomic_write_failure_keeps_existing_file(self):
        self.output.write_text("previous contents")
        with patch.object(build.os, "replace", side_effect=OSError("disk failure")):
            with self.assertRaises(OSError):
                build.atomic_json_write(self.output, {"new": True})
        self.assertEqual(self.output.read_text(), "previous contents")
        self.assertEqual(list(self.output.parent.iterdir()), [self.output])


if __name__ == "__main__":
    unittest.main()
