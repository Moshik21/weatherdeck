"""Goal headers (feed 1.7, docs/feed-spec.md "Goals"): the goals the lanes serve, with a count under each.

Pure functions: no I/O, no clock, nothing about any particular tool. A source names the goal of a row (`goal` on items, next and
done) and says, per goal, how many rows its feed carries and which counts may be low (`goals[]`). The host merges them for the
view, so a goal two sources share is one header, a row two sources both carry is counted once, and a count that any source says
may be low stays "or more":

    headers   one header per goal, in the order the sources name them, counted over the merged rows
"""

OR_MORE = ("lanes", "next", "done")   # the counts a header has, in the order it says them


def headers(declared, items, nxt, done, done_cut=False):
    """[{name, lanes, next, done, or_more}] for the view.

    `declared` is each source's own `goals[]`, newest source first; `items`, `nxt` and `done` are the merged rows the view carries
    (`done` as shipped, after the view's own cut). A goal is a header when a source named it or a row carries it, and it stays one
    only while a carried row carries it: absent is not zero. Its counts are the carried rows that carry its name (a name is compared
    as written, so two homes that spell a goal alike share one header), never the sum of the sources' own counts, which would count
    a second-hand copy twice. `or_more` is every count a source marked as possibly low, and `done` too when `done_cut` says the
    merged landed rows were more than the view carries. Rows with no goal are in no header: the board groups them under their
    project."""
    order, more = [], {}
    for goals in declared:
        for g in goals if isinstance(goals, list) else []:
            name = g.get("name") if isinstance(g, dict) else None
            if isinstance(name, str) and name:
                if name not in more:
                    order.append(name)
                more.setdefault(name, set()).update(k for k in (g.get("or_more") or []) if k in OR_MORE)
    counts = {}
    for kind, rows in (("lanes", items), ("next", nxt), ("done", done)):
        for row in rows:
            name = row.get("goal")
            if isinstance(name, str) and name:
                if name not in more:
                    order.append(name)
                    more[name] = set()
                counts.setdefault(name, dict.fromkeys(OR_MORE, 0))[kind] += 1
    if done_cut:
        for name in counts:
            more[name].add("done")
    return [dict(name=name, **counts[name], or_more=[k for k in OR_MORE if k in more[name]]) for name in order if name in counts]
