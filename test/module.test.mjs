// The module inside a fake Companion host context, with a mock fetch: what
// each action sends, and what variables, feedbacks and presets it defines.
// The real Companion runtime and a Stream Deck are not exercised here.
import test from 'node:test'
import assert from 'node:assert/strict'
import TimeDeckInstance, { UpgradeScripts } from '../main.js'
import { toCommand } from '../actions.js'
import { toRequests } from '../lib/timedeck-client.mjs'

globalThis.COMPANION_LOGGER = () => {}

const NOW = Date.now()
const DECK = {
	id: 'abcdef12',
	role: 'control',
	rev: 4,
	configRev: 2,
	serverNow: NOW,
	event: { name: 'Product Summit', referenceZone: 'Europe/Berlin' },
	activeTimerId: 't1',
	timers: {
		t1: { id: 't1', name: 'Keynote', type: 'countdown', durationMs: 600000, startValueMs: 0, segments: [], rounds: 1, overtime: true, thresholds: { warningMs: 120000, criticalMs: 30000 }, status: 'running', startedAt: NOW - 590000, accumulatedMs: 0 },
		t2: { id: 't2', name: 'Q&A', type: 'countdown', durationMs: 300000, startValueMs: 0, segments: [], rounds: 1, overtime: true, thresholds: { warningMs: 120000, criticalMs: 30000 }, status: 'idle', startedAt: null, accumulatedMs: 0 },
	},
	canvases: { c1: { id: 'c1', name: 'Main stage' }, c2: { id: 'c2', name: 'Confidence' } },
	canvasOrder: ['c1', 'c2'],
	sessions: [
		{ id: 's1', title: 'Keynote', timerId: 't1' },
		{ id: 's2', title: 'Q&A', timerId: 't2' },
	],
	activeSessionId: 's1',
	output: { blackout: false, message: { text: 'Wrap up', tone: 'warning', until: null } },
}

function fakeContext() {
	const ctx = {
		_isInstanceContext: true,
		id: 'test-1',
		label: 'timedeck',
		upgradeScripts: [],
		sharedUdpSocketHandlers: new Map(),
		defs: {},
		values: {},
		checked: [],
		status: [],
		saveConfig() {},
		updateStatus(s, m) { ctx.status.push([s, m]) },
		setActionDefinitions(d) { ctx.defs.actions = d },
		setFeedbackDefinitions(d) { ctx.defs.feedbacks = d },
		setPresetDefinitions(structure, presets) { ctx.defs.presets = { structure, presets } },
		setVariableDefinitions(d) { ctx.defs.variables = d },
		setVariableValues(v) { Object.assign(ctx.values, v) },
		getVariableValue(id) { return ctx.values[id] },
		checkFeedbacks(kinds) { ctx.checked.push(...kinds) },
		checkAllFeedbacks() {},
		checkFeedbacksById() {},
		subscribeActions() {},
		unsubscribeActions() {},
		unsubscribeFeedbacks() {},
		recordAction() {},
		oscSend() {},
		setCompositeElementDefinitions() {},
	}
	return ctx
}

function mockFetch() {
	const calls = []
	const f = async (url, init) => {
		const u = new URL(url)
		const body = init.body ? JSON.parse(init.body) : undefined
		calls.push({ method: init.method, path: u.pathname + u.search, body, token: init.headers['X-Deck-Token'] })
		const json = (b, s = 200) => new Response(JSON.stringify(b), { status: s })
		if (u.pathname.endsWith('/wait')) return json({ error: { code: 'not_found', message: 'Not found' } }, 404)
		if (u.pathname.endsWith('/displays')) return json({ displays: [{ id: 'stage-left-01', name: 'Stage left', online: true }], serverNow: Date.now() })
		if (init.method === 'GET') return json(u.search ? { unchanged: true, rev: 4, serverNow: Date.now() } : { ...DECK, serverNow: Date.now() })
		if (u.pathname.endsWith('/commands')) return json({ results: [{ ok: true }], rev: 5, serverNow: Date.now(), timers: DECK.timers, activeTimerId: 't1' })
		if (u.pathname.endsWith('/output')) return json({ output: { blackout: !!body.blackout, message: body.message ?? null }, rev: 5, serverNow: Date.now() })
		return json({ ok: true, ...DECK })
	}
	return { f, calls }
}

const until = async (fn, ms = 3000) => {
	const end = Date.now() + ms
	while (!fn()) {
		if (Date.now() > end) throw new Error('timed out')
		await new Promise((r) => setTimeout(r, 10))
	}
}

async function boot() {
	const ctx = fakeContext()
	const { f, calls } = mockFetch()
	const inst = new TimeDeckInstance(ctx)
	inst.fetchImpl = f
	await inst.init({ url: 'http://deck.test', deck: 'abcdef12', longPoll: true, stepMs: 60000, timer: '' }, true, { token: 'secret-token' })
	await until(() => inst.deck && ctx.defs.actions.activate_timer.options[0].choices.length === 2 && ctx.defs.actions.publish_canvas.options[0].choices.length === 1)
	return { ctx, inst, calls }
}

test('entry point: default export class, UpgradeScripts array', () => {
	assert.equal(typeof TimeDeckInstance, 'function')
	assert.ok(Array.isArray(UpgradeScripts))
})

test('each action sends the right request with the control token', async () => {
	const { ctx, inst, calls } = await boot()
	try {
		const run = async (id, options) => {
			calls.length = 0
			await ctx.defs.actions[id].callback({ actionId: id, options, controlId: 'x', surfaceId: undefined }, {})
			return calls.filter((c) => c.method !== 'GET')
		}
		for (const a of ['start', 'pause', 'resume', 'toggle', 'reset', 'restart', 'end']) {
			const [c] = await run(a, { timer: '__active' })
			assert.deepEqual([c.method, c.path, c.body, c.token], ['POST', '/api/decks/abcdef12/commands', { commands: [{ action: a }] }, 'secret-token'], a)
		}
		assert.deepEqual((await run('start', { timer: 't2' }))[0].body, { commands: [{ action: 'start', timerId: 't2' }] })
		assert.deepEqual((await run('add_time', { ms: 30000, timer: '__active' }))[0].body, { commands: [{ action: 'adjust', deltaMs: 30000 }] })
		assert.deepEqual((await run('subtract_time', { ms: 60000, timer: '__active' }))[0].body, { commands: [{ action: 'adjust', deltaMs: -60000 }] })
		assert.deepEqual((await run('set_duration', { duration: '1:30:00', timer: '__active' }))[0].body, { commands: [{ action: 'setDuration', durationMs: 5400000 }] })
		assert.deepEqual((await run('activate_timer', { timer: 't2' }))[0].body, { commands: [{ action: 'activate', timerId: 't2' }] })
		const msg = (await run('send_message', { text: 'Five minutes', tone: 'urgent', style: 'takeover', seconds: 20, audience: true }))[0]
		assert.deepEqual([msg.path, msg.body], ['/api/decks/abcdef12/output', { message: { text: 'Five minutes', tone: 'urgent', style: 'takeover', durationMs: 20000, audience: true } }])
		assert.deepEqual((await run('clear_message', {}))[0].body, { message: null })
		assert.deepEqual((await run('blackout', { mode: 'on' }))[0].body, { blackout: true })
		assert.deepEqual((await run('blackout', { mode: 'off' }))[0].body, { blackout: false })
		const canvas = (await run('publish_canvas', { display: 'stage-left-01', canvas: 'c2' }))[0]
		assert.deepEqual([canvas.method, canvas.path, canvas.body], ['PATCH', '/api/decks/abcdef12/displays/stage-left-01', { canvasId: 'c2' }])
		assert.deepEqual((await run('publish_canvas', { display: 'stage-left-01', canvas: '__link' }))[0].body, { canvasId: null })
		const sess = await run('start_session', { session: 's2' })
		assert.deepEqual(sess.map((c) => [c.method, c.path, c.body]), [
			['PATCH', '/api/decks/abcdef12', { activeSessionId: 's2', activeTimerId: 't2' }],
			['POST', '/api/decks/abcdef12/commands', { commands: [{ action: 'restart', timerId: 't2' }] }],
		])
		// A bad option is logged, never thrown into Companion.
		assert.equal(await inst.run(toCommand('send_message', { text: '' })), null)
	} finally {
		await inst.destroy()
	}
})

test('dropdowns come from the deck; variables and feedbacks follow its state', async () => {
	const { ctx, inst } = await boot()
	try {
		assert.deepEqual(ctx.defs.actions.activate_timer.options[0].choices.map((c) => c.id), ['t1', 't2'])
		assert.deepEqual(ctx.defs.actions.publish_canvas.options[1].choices.map((c) => c.id), ['c1', 'c2', '__link'])
		assert.deepEqual(ctx.defs.actions.start_session.options[0].choices.map((c) => c.id), ['s1', 's2'])
		await until(() => ctx.values.phase === 'running')
		assert.match(ctx.values.time, /^00:(0\d|10)$/)
		assert.equal(ctx.values.status, 'critical')
		assert.ok(ctx.values.remaining_ms > 0 && ctx.values.remaining_ms <= 10000)
		assert.equal(ctx.values.timer_name, 'Keynote')
		assert.equal(ctx.values.active_timer_id, 't1')
		assert.equal(ctx.values.event_name, 'Product Summit')
		assert.equal(ctx.values.next_session, 'Q&A')
		assert.equal(ctx.values.message, 'Wrap up')
		const fb = ctx.defs.feedbacks
		assert.equal(fb.timer_phase.callback({ options: { phase: 'running' } }), true)
		assert.equal(fb.timer_phase.callback({ options: { phase: 'paused' } }), false)
		assert.equal(fb.timer_status.callback({ options: { status: 'critical' } }), true)
		assert.equal(fb.status_colours.callback({ options: {} }).bgcolor, 0xff5a4e)
		assert.equal(fb.blackout_on.callback({ options: {} }), false)
		assert.equal(fb.message_showing.callback({ options: {} }), true)
		assert.ok(ctx.checked.includes('timer_status'))
		assert.deepEqual(Object.keys(ctx.defs.variables).sort(), ['active_timer_id', 'blackout', 'connected', 'event_name', 'message', 'next_session', 'phase', 'remaining_ms', 'session_title', 'status', 'time', 'timer_name'])
		assert.ok(ctx.status.some(([s]) => s === 'ok'))
	} finally {
		await inst.destroy()
	}
})

test('presets reference real actions and feedbacks', async () => {
	const { ctx, inst } = await boot()
	try {
		const { structure, presets } = ctx.defs.presets
		const ids = structure.flatMap((s) => s.definitions.flatMap((g) => g.presets))
		for (const id of ids) assert.ok(presets[id], `preset ${id}`)
		for (const p of Object.values(presets)) {
			for (const step of p.steps) for (const a of step.down) assert.ok(ctx.defs.actions[a.actionId], a.actionId)
			for (const f of p.feedbacks) assert.ok(ctx.defs.feedbacks[f.feedbackId], f.feedbackId)
		}
		assert.match(presets.status_display.style.text, /\$\(timedeck:time\)/)
		assert.deepEqual(structure[0].definitions[0].presets, ['start', 'pause', 'toggle', 'reset', 'restart', 'end'])
	} finally {
		await inst.destroy()
	}
})

test('missing settings show as bad config, without network calls', async () => {
	const ctx = fakeContext()
	const { f, calls } = mockFetch()
	const inst = new TimeDeckInstance(ctx)
	inst.fetchImpl = f
	await inst.init({ url: '', deck: '' }, true, {})
	assert.equal(ctx.status.at(-1)[0], 'bad_config')
	assert.equal(calls.length, 0)
	assert.equal(await inst.run({ action: 'start' }), null)
	await inst.destroy()
})

test('toCommand covers every action id and maps through the shared client', () => {
	const deck = { activeTimerId: 't1', timers: { t1: {}, t2: {} }, sessions: [{ id: 's2', timerId: 't2' }], output: { blackout: false } }
	assert.deepEqual(toRequests(toCommand('blackout', { mode: 'toggle' }), { deck })[0].body, { blackout: true })
	assert.throws(() => toCommand('fly', {}))
})
