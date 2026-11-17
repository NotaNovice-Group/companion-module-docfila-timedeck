// Companion actions. Every callback builds one command object (the same
// vocabulary as the venue bridge and the MCP server) and hands it to
// self.run(), which sends it through the shared TimeDeck client.

const TRANSPORT = [
	['start', 'Start'],
	['pause', 'Pause'],
	['resume', 'Resume'],
	['toggle', 'Start / pause'],
	['reset', 'Reset'],
	['restart', 'Restart'],
	['end', 'End'],
]

const ACTIVE = '__active'

/** Dropdown choices from the last known deck. */
export function choicesFor(deck, displays = []) {
	const timers = deck && deck.timers ? Object.values(deck.timers).map((t) => ({ id: t.id, label: `${t.name} (${t.id})` })) : []
	const canvases =
		deck && deck.canvases ? (deck.canvasOrder || Object.keys(deck.canvases)).filter((id) => deck.canvases[id]).map((id) => ({ id, label: deck.canvases[id].name || id })) : []
	const sessions = deck && Array.isArray(deck.sessions) ? deck.sessions.map((s) => ({ id: s.id, label: s.title || s.id })) : []
	return {
		timers,
		canvases,
		sessions,
		displays: displays.map((d) => ({ id: d.id, label: `${d.name || d.id}${d.online ? '' : ' (offline)'}` })),
	}
}

/** Map one action event to a command object. Exported for tests. */
export function toCommand(actionId, o = {}) {
	const timerId = o.timer && o.timer !== ACTIVE ? String(o.timer) : undefined
	const transport = TRANSPORT.find(([id]) => id === actionId)
	if (transport) return { action: actionId, timerId }
	switch (actionId) {
		case 'add_time':
			return { action: 'add', ms: Number(o.ms), timerId }
		case 'subtract_time':
			return { action: 'sub', ms: Number(o.ms), timerId }
		case 'set_duration':
			return { action: 'duration', ms: String(o.duration ?? '').trim(), timerId }
		case 'activate_timer':
			return { action: 'activate', timerId: String(o.timer || '') }
		case 'send_message':
			return {
				action: 'message',
				text: String(o.text ?? ''),
				tone: o.tone || 'info',
				style: o.style || 'banner',
				durationMs: Number(o.seconds) > 0 ? Math.round(Number(o.seconds) * 1000) : null,
				audience: o.audience === true,
			}
		case 'clear_message':
			return { action: 'clearMessage' }
		case 'blackout':
			return { action: 'blackout', on: o.mode === 'on' ? true : o.mode === 'off' ? false : 'toggle' }
		case 'publish_canvas':
			return { action: 'canvas', displayId: String(o.display || ''), canvasId: o.canvas === '__link' ? null : String(o.canvas || '') }
		case 'start_session':
			return { action: 'session', sessionId: String(o.session || '') }
		default:
			throw new Error(`Unknown action ${actionId}`)
	}
}

export function updateActions(self) {
	const c = choicesFor(self.deck, self.displays)
	const timerOpt = {
		type: 'dropdown',
		id: 'timer',
		label: 'Timer',
		default: ACTIVE,
		choices: [{ id: ACTIVE, label: 'The active timer' }, ...c.timers],
		allowCustom: true,
	}
	const msOpt = { type: 'number', id: 'ms', label: 'Milliseconds', default: self.config?.stepMs || 60000, min: 1000, max: 3600000, step: 1000 }
	const cb = (id) => async (event) => {
		await self.run(toCommand(id, event.options))
	}
	const defs = {}
	for (const [id, name] of TRANSPORT) defs[id] = { name: `Timer: ${name}`, options: [timerOpt], callback: cb(id) }
	defs.add_time = { name: 'Time: add', options: [msOpt, timerOpt], callback: cb('add_time') }
	defs.subtract_time = { name: 'Time: subtract', options: [msOpt, timerOpt], callback: cb('subtract_time') }
	defs.set_duration = {
		name: 'Time: set duration',
		options: [
			{ type: 'textinput', id: 'duration', label: 'Duration ("15m", "1:30:00", "45s" or milliseconds)', default: '15m' },
			timerOpt,
		],
		callback: cb('set_duration'),
	}
	defs.activate_timer = {
		name: 'Timer: make active',
		options: [{ type: 'dropdown', id: 'timer', label: 'Timer', default: c.timers[0]?.id ?? '', choices: c.timers, allowCustom: true }],
		callback: cb('activate_timer'),
	}
	defs.send_message = {
		name: 'Message: show',
		options: [
			{ type: 'textinput', id: 'text', label: 'Text (up to 280 characters)', default: 'Please wrap up' },
			{
				type: 'dropdown',
				id: 'tone',
				label: 'Tone',
				default: 'info',
				choices: [
					{ id: 'info', label: 'Info' },
					{ id: 'warning', label: 'Warning' },
					{ id: 'urgent', label: 'Urgent' },
				],
			},
			{
				type: 'dropdown',
				id: 'style',
				label: 'Style',
				default: 'banner',
				choices: [
					{ id: 'banner', label: 'Banner' },
					{ id: 'takeover', label: 'Full screen takeover' },
				],
			},
			{ type: 'number', id: 'seconds', label: 'Hide after (seconds, 0 = until cleared)', default: 0, min: 0, max: 3600 },
			{ type: 'checkbox', id: 'audience', label: 'Also show on audience phones', default: false },
		],
		callback: cb('send_message'),
	}
	defs.clear_message = { name: 'Message: clear', options: [], callback: cb('clear_message') }
	defs.blackout = {
		name: 'Screens: blackout',
		options: [
			{
				type: 'dropdown',
				id: 'mode',
				label: 'Blackout',
				default: 'toggle',
				choices: [
					{ id: 'on', label: 'On' },
					{ id: 'off', label: 'Off' },
					{ id: 'toggle', label: 'Toggle' },
				],
			},
		],
		callback: cb('blackout'),
	}
	defs.publish_canvas = {
		name: 'Screens: send a canvas to a display',
		options: [
			{ type: 'dropdown', id: 'display', label: 'Display', default: c.displays[0]?.id ?? '', choices: c.displays, allowCustom: true },
			{
				type: 'dropdown',
				id: 'canvas',
				label: 'Canvas',
				default: c.canvases[0]?.id ?? '__link',
				choices: [...c.canvases, { id: '__link', label: 'Follow its own link' }],
				allowCustom: true,
			},
		],
		callback: cb('publish_canvas'),
	}
	defs.start_session = {
		name: 'Rundown: start a session',
		description: 'Makes the session live and restarts its timer',
		options: [{ type: 'dropdown', id: 'session', label: 'Session', default: c.sessions[0]?.id ?? '', choices: c.sessions, allowCustom: true }],
		callback: cb('start_session'),
	}
	self.setActionDefinitions(defs)
}
