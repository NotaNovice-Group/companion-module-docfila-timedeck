// DocFila TimeDeck for Bitfocus Companion (module-base 2.x: ESM, default
// export of the instance class, UpgradeScripts as a named export).
//
// Follows one deck through the shared TimeDeck client: a full read, then
// the long-poll (/wait) when the server has it, else 1 s polling. Variables
// and feedbacks are recomputed locally five times a second from the timer's
// anchors, so the countdown on a button never waits for a poll.

import { InstanceBase, InstanceStatus } from '@companion-module/base'
import { TimeDeckClient, DeckFollower, snapshot } from './lib/timedeck-client.mjs'
import { getConfigFields, DEFAULT_URL } from './config.js'
import { updateActions, choicesFor } from './actions.js'
import { updateFeedbacks } from './feedbacks.js'
import { updateVariableDefinitions, variableValues } from './variables.js'
import { updatePresets } from './presets.js'
import { UpgradeScripts } from './upgrades.js'

export { UpgradeScripts }

const TICK_MS = 200
const DISPLAYS_MS = 30000

export default class TimeDeckInstance extends InstanceBase {
	constructor(internal) {
		super(internal)
		this.config = {}
		this.secrets = {}
		this.deck = null
		this.displays = []
		this.online = null
		this.state = snapshot(null, Date.now())
		this.lastValues = {}
		this.lastChoices = ''
		this.follower = null
		this.timer = null
		this.displayTimer = null
	}

	async init(config, _isFirstInit, secrets) {
		this.config = config || {}
		this.secrets = secrets || {}
		updateVariableDefinitions(this)
		updateFeedbacks(this)
		updateActions(this)
		updatePresets(this)
		this.connect()
	}

	async configUpdated(config, secrets) {
		this.config = config || {}
		this.secrets = secrets || {}
		this.disconnect()
		this.deck = null
		this.displays = []
		this.lastChoices = ''
		updateActions(this)
		this.connect()
	}

	async destroy() {
		this.disconnect()
	}

	getConfigFields() {
		return getConfigFields()
	}

	connect() {
		this.client = new TimeDeckClient({
			url: this.config.url || DEFAULT_URL,
			deck: this.config.deck,
			token: this.secrets.token,
			fetch: this.fetchImpl,
			userAgent: 'companion-module-docfila-timedeck',
		})
		try {
			this.client.check()
		} catch (e) {
			this.updateStatus(InstanceStatus.BadConfig, e.message)
			return
		}
		this.updateStatus(InstanceStatus.Connecting)
		this.follower = new DeckFollower(this.client, {
			longPoll: this.config.longPoll !== false,
			stepMs: Number(this.config.stepMs) || 60000,
		})
		this.follower.on('log', (level, text) => this.log(level === 'warn' ? 'warn' : level === 'error' ? 'error' : level === 'debug' ? 'debug' : 'info', text))
		this.follower.on('deck', (deck) => this.onDeck(deck))
		this.follower.on('online', () => {
			this.online = true
			this.updateStatus(InstanceStatus.Ok)
			this.tick(true)
		})
		this.follower.on('offline', (e) => {
			this.online = false
			const auth = e.status === 401 || e.code === 'revoked' || e.code === 'forbidden'
			this.updateStatus(auth ? InstanceStatus.AuthenticationFailure : InstanceStatus.ConnectionFailure, e.message)
			this.tick(true)
		})
		this.follower.start()
		this.timer = setInterval(() => this.tick(false), TICK_MS)
		this.displayTimer = setInterval(() => this.refreshDisplays(), DISPLAYS_MS)
	}

	disconnect() {
		if (this.follower) this.follower.stop()
		this.follower = null
		clearInterval(this.timer)
		clearInterval(this.displayTimer)
	}

	onDeck(deck) {
		const firstOrConfig = !this.deck || this.deck.configRev !== deck.configRev
		this.deck = deck
		if (firstOrConfig) this.refreshDisplays()
		this.refreshChoices()
		this.tick(true)
	}

	async refreshDisplays() {
		if (!this.client || !this.deck) return
		try {
			const r = await this.client.displays()
			this.displays = r.displays || []
			this.refreshChoices()
		} catch {
			/* the follower reports connection problems */
		}
	}

	/** Redefine actions only when timers, canvases, sessions or displays changed. */
	refreshChoices() {
		const key = JSON.stringify(choicesFor(this.deck, this.displays))
		if (key === this.lastChoices) return
		this.lastChoices = key
		updateActions(this)
	}

	/** Recompute the state; push only the variables and feedbacks that changed. */
	tick(force) {
		const now = this.follower ? this.follower.now() : Date.now()
		const prev = this.state
		this.state = snapshot(this.deck, now, { timerId: this.config.timer || null })
		const values = variableValues(this.state, this.online)
		const changed = {}
		for (const [k, v] of Object.entries(values)) if (force || this.lastValues[k] !== v) changed[k] = v
		if (Object.keys(changed).length) {
			this.setVariableValues(changed)
			Object.assign(this.lastValues, changed)
		}
		const kinds = []
		if (force || prev.phase !== this.state.phase) kinds.push('timer_phase')
		if (force || prev.status !== this.state.status || prev.phase !== this.state.phase || prev.connected !== this.state.connected) kinds.push('timer_status', 'status_colours')
		if (force || prev.blackout !== this.state.blackout) kinds.push('blackout_on')
		if (force || prev.message !== this.state.message) kinds.push('message_showing')
		if (force) kinds.push('disconnected')
		if (kinds.length) this.checkFeedbacks(...kinds)
	}

	/** Run a command object; failures are logged, never thrown at Companion. */
	async run(cmd) {
		if (!this.follower) {
			this.log('warn', 'TimeDeck is not configured: set the deck id and control token')
			return null
		}
		try {
			const r = await this.follower.exec(cmd)
			this.tick(true)
			return r
		} catch (e) {
			this.log('warn', `${cmd.action} failed: ${e.message}`)
			return null
		}
	}
}
