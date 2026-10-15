# Real-device checklist

Headless Chrome and WebKit check layout, overflow and console errors before every release (see CHANGELOG.md, "Checked
on"). They cannot check what a person sees on real glass. Before calling a release done, open the board on each device
below and tick what only a person can judge. Use the demo (`weatherdeck run --demo --scenario honest-board`, and for 0.3.0
and 0.3.1 `--scenario gaps`), so nothing real is shown, and note the device, browser version and result in the changelog.

## Signed off: the dashboard depth scene (2026-10-10)
Signed off by the maintainer on 2026-10-10, on Safari, iPhone and the 4K television, for the dashboard depth scene: the ship
deck scene with the islands ahead, the lit stern windows, and the squall over a machine that is not answering. In the
maintainer's words: "I approve of the dashboard. The device checks sign off."

What this covers: the device checks of that scene on those three devices, that is the section marked "signed off
2026-10-10" below ("The far horizon and the stern windows"). This checklist's Safari items are the Mac ones ("Safari on a
Mac"); the sign-off does not say which Safari was used. The squall over a machine that is not answering rests on the
maintainer's word alone: this checklist has no item for it, so it was not checked item by item on glass.

What this does not cover:
- Any other page of the board, and any theme other than the ship deck.
- Any other tool's device checks, and every section of this checklist that is not marked signed off.
- Any change to the scene after 2026-10-10. A new change needs a new check; this sign-off does not carry over to it.
- Browsers and devices not named above.

The sign-off is a person's word that the scene was looked at on those devices. It records no browser versions, device
models or measurements, and none are claimed here.

## Safari on a Mac
- The pixel art is crisp at the window's size (no blur on the ship or the plates), at full screen and at a half-width window.
- Resize slowly from full screen to about 1000 px wide: the stage steps in size without text overlapping plates, and
  the machine plates on the ship stay apart.
- Open a lane (Gun deck, then a row): the full words the source sent appear there, not on the board.
- Copy on a call's "say" line puts the line on the clipboard.

## iPhone (Safari)
- No sideways scroll anywhere on the board or in a deck, in portrait and landscape.
- The waiting and reserved states read calmly: no amber except on a call.
- Text is readable at arm's length without zooming; tapping a door opens its place, and Back returns.

## The TV
- From the viewing distance, the call plate's number and the off-course rows are readable; waiting rows are visibly
  quieter than off-course ones.
- A reserved machine reads RESERVED with its time and is not fogged; after its reporter goes quiet it still reads so.
- Over a few minutes, nothing flickers: plates, chips and words do not swap places or shift.
- With the browser's toolbar shown and hidden, the stage still fills the screen sensibly.

## Black holes (0.3.0, `--scenario gaps`)
- TV: the AGENT GONE row is amber like the other needs-action rows and reads as clearly; the WATCH row under the lanes
  is quieter than the lanes and every chip in it says what it counts ("Test floor 6 waiting", "2 outside").
- TV: "ANSWER 12 MIN OLD" in the call band is readable from the viewing distance and does not crowd the count.
- iPhone: the answer age sits under the calls, not in the band; the WAITING OUTSIDE, QUEUES, SHIPPING and COMING UP
  sections read in plain words, with no sideways scroll.
- Mac Safari: open the AGENT GONE lane: its Say box says what to do, not a line to copy; the Chart room lists the waits
  outside, what comes up and the shipping gap under their own headings.
- The allowance chip counts down ("out in 1 d 21 h") and the number changes at most once a minute.

## Slowed on purpose (0.7.0)
Use a source that sends a `pace` of 3 (the adapter's `fixtures/mac-busy` pushed with `--fixture`, or a real home on a busy
Mac) beside one that does not.
- TV, at the viewing distance: the trust line's second line reads "<source>: slowed on purpose (the machine is busy), reports
  about every 3 min" and is readable; no lamp, creature or colour changes for it.
- iPhone and Mac Safari: the Crow's nest row for that source says "slowed on purpose", and its detail lists PACE and COST in
  plain words (no sideways scroll); a source with no `pace` has neither line.
- Over a few minutes: the slowed source's lamp stays lit while it reports on its declared cadence, and dims then goes silent
  if it stops, in multiples of that slower cadence.

## The open sea (0.4.1)
Use any board with nothing waiting (a throwaway fleet of one to six machines, or a quiet moment on a real one), and the
sea-life demo (`weatherdeck run --demo --scenario sea-life`, theme ship-deck) for the creatures.
- TV, at the viewing distance: with nothing waiting the call plate is one line ("NOTHING WAITS ON YOU ...") and the sea
  fills the upper area; with three machines both escorts read as whole ships beside the flagship, each with its own
  plate, and none covers another or the lighthouse. A silent escort shows its own fog, only over itself.
- TV: when a call arrives the panel comes back with its crow; when the last call is answered, the sea opens again.
- TV with no pointer and no remote: no "Got it" hint ever appears, after a reload or a first visit.
- TV, keyboard or remote: `?` opens the key over the upper area; its LAST SEEN lines name each creature's last time and
  what brought it; `R` (or REPLAY in the key) plays the newest real event once more, and the bar says "Replay of ...".
  With nothing seen yet, `R` does nothing.
- A 4K TV: the same, at twice the device pixels, crisp (no blur on the ships or the plates).

## One ship per machine (0.4.0, `weatherdeck run --demo`)
The demo has three machines: the flagship in front and two escorts on the roadstead behind it.
- TV: from the viewing distance each escort reads as its own ship, its hull plate's name and word are readable, and
  the plates of neighbouring ships never touch; a silent escort's fog and a struggling one's rain sit over that ship
  only.
- TV, remote or keyboard only: the arrows reach each escort (a dashed frame and "Name: open its places"); OK opens that
  ship's places, which list only its machine's work, and Back comes out to the sea with the ships where they were.
- TV, over a few minutes: no ship changes place as states change; an escort with no work furls its sails and stays in
  its slot.
- iPhone: the convoy strip sits under the call, the mini ships are crisp, the strip scrolls sideways by itself with no
  sideways scroll of the page, and tapping a ship opens its places.
- Mac Safari: with seven or more machines (any throwaway fleet), the convoy plate says "+N SHIPS" with the words of
  what is not OK, and its count never shortens.

## At a glance (0.3.1, `--scenario gaps`)
Open the board once with `#fresh=1` after the address to see it as a first visit.
- iPhone: the first-visit hint sits over the banner; GOT IT clears it and it does not come back after a reload. (Since
  0.4.1 the TV shows none.)
- TV, remote or keyboard only: the arrows reach the ship, the lighthouse, every plate and the `?` button, each showing a
  dashed frame and its caption; OK opens it and Back (or Esc) comes out. `?` opens the key and Esc closes it.
- Mac or iPhone: leave the board's tab for more than ten minutes (another tab, the phone locked) and come back: the
  SINCE YOU LOOKED plate says what changed in words, and GOT IT clears it. It never appears on a board you were
  watching. (A wall TV that is always shown counts as watched: it shows the plate only after a reload.)
- TV with `display.tour.enabled` (or `#tour=1`), on a view other than the television profile: left alone, it visits the places
  slowly and comes home; one key stops it. On the `tv` view it never starts, and the console says so.
- iPhone: the hint and the since plate sit over the bottom of the ship banner without covering the call; the ship banner
  opens the places; the key is at the end of the page; no sideways scroll at 390 px, in portrait and landscape.
- Mac Safari: every lane row shows its age in its state next to its word; the Gun deck heads each project with its
  counts and names each row's machine; dates read as words ("yesterday", "Tue 14:00"), never as 2026-10-11.
- Any device: with the browser's site data blocked (a private window), the board works and simply shows no since plate.

## The far horizon and the stern windows (`--scenario horizon-open`) (signed off 2026-10-10)
- TV, from the viewing distance: the islands on the horizon read as land at three distances (the near one largest), the gate's
  beacon is visible, and a dotted island (wait 45 s) is clearly "not current" rather than missing. At night the rim shows.
- TV: the stern windows read as lit, dark and shuttered on the flagship and the full-scale escorts; say which of the three you
  cannot tell apart at that distance.
- iPhone: the banner's one island and the flagship's windows are visible and nothing wraps or overflows.

## The open sea as the front door again (Unreleased): not yet checked on a device
The TV's `#/sea` is the full-screen sea again and the page board moved to `#/board` (theme spec section 24.4). Checked headless
only (1920 x 1080 on the full and `tv` views, 390 px), against a saved live view. A person needs to check it on the TV and the
host's own screen, and note device, browser and result in the changelog.
- TV (`tv` view), from across the room: the open sea fills the screen with every machine's ship and name plate, the sea and crew
  move (not a still picture), the headline card's top call and its "+N more" are readable, and there is no Lists door.
- TV: a ship's badge (the needs glyph and a number, the failed glyph and a number) reads as quiet beside its name, and its numbers
  agree with the card and the log; say if either glyph is too small to tell apart at that distance.
- TV: the remote's arrows reach the ship, Enter opens its plan, a place opens its list, Esc and the plan's OPEN SEA come back out.
- The host's own page (`127.0.0.1:8787`): Lists beside the `?` and the plan's Lists door open the page board, and the headline card opens the Bridge;
  its OPEN SEA, Esc and Back return to the sea; left idle a minute on the board, it sails home to the sea.
- iPhone: `#/sea` is still the page board, unchanged.

## The page board (0.7.0, `--scenario lane-state`): not yet checked on a device
The maintainer's sign-off above covered the depth scene only. The page board (the three-state strip, the lane rows, the key, the
places and the sea panel) is a new layout and has had headless-browser checks only (1920, 1440 and 390 px, both themes). A person
needs to check it on glass, and note device, browser and result in the changelog.
- TV, from the viewing distance: the strip's three states are told apart at a glance, a lane's state word and icon are readable, and a
  call's title is readable without the reason; the state word is never the only thing that says what the colour says.
- TV: the page does not shift or flicker over a few minutes (it drifts by 2 px a step for burn-in, nothing else moves).
- Safari on a Mac and a laptop at 1440 px: two columns, a sticky header, the Key opens over the page and closes with its button or Esc.
- iPhone: one column, no sideways scroll in portrait or landscape; the Key button is reachable at the top; "worker notes" and the
  "+N waiting on a check" fold open and close with a tap; Copy on a call puts its line on the clipboard.
- All: the sea panel is crisp (no blur on the ship), and a caption sits under every picture drawn.
- Goals (`--scenario goals`; the grouping is checked headless only): a goal header's name and count line ("N lanes ... N next, N done, or more") read
  as the heading of the lanes under it, a project group tagged "no goal set: shown by project" is told apart from a goal, and with the default demo
  (no goals) the board is as before and says no goals are set.
