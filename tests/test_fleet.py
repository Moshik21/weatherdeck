"""Contract tests for the fleet (src/weatherdeck/fleet.py): ship order, the ships drawn and the convoy past them, berths, the
hull word per machine state and the convoy's count plate. Added under the owner's narrow exception for pure core logic
(CONTRIBUTING.md): synthetic data, standard library only, no network."""
import unittest

from weatherdeck import fleet


def M(mid, label=None):
    return {"id": mid, "label": label or mid}


class Flagship(unittest.TestCase):
    def test_primary_sources_machine(self):
        srcs = [{"id": "a", "machine": "zeta", "kind": "secondary"}, {"id": "b", "machine": "yew", "kind": "primary"}]
        self.assertEqual(fleet.flagship(srcs, [M("yew"), M("zeta")]), "yew")

    def test_configured_wins_when_known(self):
        srcs = [{"id": "b", "machine": "yew", "kind": "primary"}]
        self.assertEqual(fleet.flagship(srcs, [M("yew"), M("zeta")], "zeta"), "zeta")
        self.assertEqual(fleet.flagship(srcs, [M("yew"), M("zeta")], "nowhere"), "yew")

    def test_placeholder_is_not_reporting(self):
        srcs = [{"id": "p", "machine": "aster", "kind": "primary", "placeholder": True}, {"id": "q", "machine": "birch"}]
        self.assertEqual(fleet.flagship(srcs, [M("aster"), M("birch")]), "birch")

    def test_no_source_first_by_name(self):
        self.assertEqual(fleet.flagship([], [M("b", "Willow"), M("a", "alder")]), "a")
        self.assertIsNone(fleet.flagship([], []))


class Order(unittest.TestCase):
    def test_flagship_first_then_by_folded_name(self):
        ms = [M("c", "cedar"), M("a", "Birch-Two"), M("b", "birch_one"), M("f", "Fir")]
        self.assertEqual(fleet.order(ms, "f"), ["f", "b", "a", "c"])

    def test_configured_order_before_names(self):
        ms = [M("c"), M("a"), M("b"), M("d")]
        self.assertEqual(fleet.order(ms, "d", ["c", "missing", "d", "c"]), ["d", "c", "a", "b"])

    def test_order_ignores_state(self):
        calm = [dict(M("a"), status="ok"), dict(M("b"), status="ok")]
        loud = [dict(M("a"), status="ok"), dict(M("b"), status="down", health={"state": "lost"})]
        self.assertEqual(fleet.order(calm, "a"), fleet.order(loud, "a"))

    def test_unknown_flagship_is_not_inserted(self):
        self.assertEqual(fleet.order([M("a"), M("b")], "zz"), ["a", "b"])


class Plan(unittest.TestCase):
    def test_up_to_six_are_ships(self):
        p = fleet.plan(list("abcdef"))
        self.assertEqual([s["role"] for s in p["ships"]], ["flagship"] + ["escort"] * 5)
        self.assertEqual([s["slot"] for s in p["ships"]], list(range(6)))
        self.assertEqual(p["convoy"], [])

    def test_past_six_the_rest_is_a_convoy(self):
        p = fleet.plan(list("abcdefghi"))
        self.assertEqual([s["id"] for s in p["ships"]], list("abcdef"))
        self.assertEqual(p["convoy"], list("ghi"))

    def test_cap_is_bounded(self):
        self.assertEqual(len(fleet.plan(list("abcdefgh"), 99)["ships"]), 6)
        self.assertEqual(len(fleet.plan(list("abc"), 1)["ships"]), 1)
        self.assertEqual(fleet.plan([], 6), {"ships": [], "convoy": []})

    def test_view_from_config(self):
        srcs = [{"id": "s", "machine": "m3", "kind": "primary"}]
        ms = [M("m%d" % i) for i in range(1, 9)]
        v = fleet.view(srcs, ms, {"fleet": {"order": ["m8"], "max_ships": 4}})
        self.assertEqual(v["flagship"], "m3")
        self.assertEqual(v["order"][:3], ["m3", "m8", "m1"])
        self.assertEqual([s["id"] for s in v["ships"]], ["m3", "m8", "m1", "m2"])
        self.assertEqual(v["convoy"], ["m4", "m5", "m6", "m7"])
        self.assertEqual(v["max_ships"], 4)


class Berth(unittest.TestCase):
    def test_idle_healthy_moors(self):
        self.assertEqual(fleet.berth("ok"), "harbor")
        self.assertEqual(fleet.berth("reserved"), "harbor")
        self.assertEqual(fleet.berth("ok", lanes=1), "sea")
        self.assertEqual(fleet.berth("ok", calls=1), "sea")

    def test_silence_and_trouble_stay_at_sea(self):
        for key in ("silent", "lost", "alert", "down", "warn", "unknown"):
            self.assertEqual(fleet.berth(key), "sea", key)

    def test_asleep_anchors(self):
        self.assertEqual(fleet.berth("silent", asleep=True), "anchored")


class HullWord(unittest.TestCase):
    def test_words(self):
        self.assertEqual(fleet.hull_word("ok"), ("ok", True))
        self.assertEqual(fleet.hull_word("draining"), ("draining", True))
        self.assertEqual(fleet.hull_word("alert"), ("alert", False))
        self.assertEqual(fleet.hull_word("silent"), ("silent", False))
        self.assertEqual(fleet.hull_word("lost"), ("lost", False))
        self.assertEqual(fleet.hull_word("silent", asleep=True), ("asleep", True))

    def test_rest_is_neutral(self):
        self.assertTrue(fleet.hull_word("reserved")[1])
        self.assertTrue(fleet.hull_word("maintenance")[1])

    def test_unknown_key_says_no_word(self):
        self.assertEqual(fleet.hull_word("??"), ("no_word", False))


class ConvoySummary(unittest.TestCase):
    def test_worst_first_and_ok_unsaid(self):
        s = fleet.convoy_summary([("ok", False), ("silent", False), ("alert", False), ("silent", True), ("reserved", False)])
        self.assertEqual(s["n"], 5)
        self.assertEqual(s["words"], [["alert", 1], ["silent", 1], ["asleep", 1], ["reserved", 1]])

    def test_all_ok(self):
        self.assertEqual(fleet.convoy_summary([("ok", False)] * 3), {"n": 3, "words": []})

    def test_more_trouble_never_reads_calmer(self):
        calm = fleet.convoy_summary([("ok", False), ("ok", False)])
        worse = fleet.convoy_summary([("ok", False), ("lost", False)])
        self.assertEqual(calm["n"], worse["n"])
        self.assertTrue(worse["words"] and not calm["words"])


if __name__ == "__main__":
    unittest.main()
