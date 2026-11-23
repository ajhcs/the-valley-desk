import sys
import unittest
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from build import geo_series_supported


class GeoSuperSeriesTest(unittest.TestCase):
    paper = {"id": "doi:10.1234/paper", "pmid": "42"}
    aggregate = {"title": "Study data", "superseries_of": ["GSE1", "GSE2"]}

    def test_explicit_name_supports_aggregate(self):
        self.assertTrue(geo_series_supported("GSE3", self.aggregate, self.paper,
                                             {(self.paper["id"], "GSE3")}))

    def test_all_components_must_cite_producing_paper(self):
        components = {key: {"citations": [{"pmid": "42"}]} for key in ("GSE1", "GSE2")}
        with patch("build.read_cache", side_effect=lambda _, key: components.get(key)):
            self.assertTrue(geo_series_supported("GSE3", self.aggregate, self.paper, set()))
            components["GSE2"] = {"citations": [{"pmid": "99"}]}
            self.assertFalse(geo_series_supported("GSE3", self.aggregate, self.paper, set()))
            del components["GSE2"]
            self.assertFalse(geo_series_supported("GSE3", self.aggregate, self.paper, set()))

    def test_eligible_component_is_independent_of_unsupported_parent(self):
        component = {"title": "Study measurements", "subseries_of": ["GSE3"]}
        self.assertTrue(geo_series_supported("GSE1", component, self.paper, set()))
        self.assertFalse(geo_series_supported("GSE3", {"title": "Study data"}, self.paper,
                                              set(), known_aggregate=True))
