## DocFila TimeDeck

Control [TimeDeck](https://timedeck.docfila.com) stage timers from your
buttons, and show the live time and status on them.

### Setup

1. In TimeDeck, make the event live and open **Outputs and links**, then
   **Links and access**. Copy the **Operator link** (it ends in
   `#join=DECK.TOKEN`), or, for buttons that only send messages and
   blackout, the **Moderator link (messages only)** (it ends in
   `#mod=DECK.TOKEN`).
2. In this connection's settings:
   - **TimeDeck server:** `https://timedeck.docfila.com` (or your own host;
     a bare venue address such as `192.168.1.20:8080` uses `http`, so type
     `https://` for a venue host started with `--https`)
   - **Deck id:** the part of the link between `#join=` (or `#mod=`) and the dot
   - **Control token:** the part after the dot (stored as a secret); a
     moderator token goes in the same field
   - **Follow timer id:** leave blank to follow whichever timer is active
3. The connection turns green when it can read the event.

The control token gives full control of the event: timers, rundown,
screens and links. The moderator token can only show and clear messages and
black out screens; with it, timer, rundown and canvas buttons answer "This
link cannot do that", and the time and status still show on the buttons.
Use it for a stage manager's deck. Replacing the link in TimeDeck (Replace)
disconnects this module until you paste the new token.

### Actions

- **Timer:** Start, Pause, Resume, Start / pause, Reset, Restart, End (the
  active timer or one you pick), Make active
- **Time:** Add, Subtract (milliseconds), Set duration (`15m`, `1:30:00`, `45s`)
- **Message:** Show (text, tone, banner or full screen takeover, hide after N
  seconds, also on audience phones), Clear
- **Screens:** Blackout on, off or toggle; Send a canvas to a display
- **Rundown:** Start a session (makes it live and restarts its timer)

Timer, canvas, display and session lists fill in from the event once connected.

### Feedbacks

- **Timer: is running / paused / idle / ended**
- **Timer: status is normal / warning / critical / overtime**
- **Timer: colour the button by status** (green, amber, red, dark red in
  overtime, grey before start)
- **Screens: blackout is on**
- **Message: a message is showing**
- **Connection: TimeDeck is unreachable**

### Variables

`$(timedeck:time)` (`14:59`, `+00:12` in overtime), `remaining_ms`, `status`,
`phase`, `timer_name`, `active_timer_id`, `event_name`, `session_title`,
`next_session`, `message`, `blackout`, `connected`. Replace `timedeck` with
your connection's label.

### Presets

- **Transport:** Start, Pause, Start / pause, Reset, Restart, End; +1 min,
  -1 min, +30 s
- **Display:** Time and status (colours by status, press to start or pause),
  Status word, Next session
- **Screens and messages:** Blackout toggle, Wrap up message, Clear message

### Sync

The module holds a long-poll open, so changes made in TimeDeck or by other
operators show within a moment; servers without it are polled every second.
The countdown on the buttons is computed locally five times a second from
the timer's anchors and the server clock. If the network drops, the module
retries quietly, shows the connection as failed, and recovers by itself.
