// Variables, as $(timedeck:time) etc. (the prefix is the connection label).

export const VARIABLES = {
	time: { name: 'Time shown on the timer (mm:ss, +mm:ss in overtime)' },
	remaining_ms: { name: 'Remaining milliseconds (negative in overtime)' },
	status: { name: 'Status: normal, warning, critical or overtime' },
	phase: { name: 'Phase: idle, running, paused, ended or waiting' },
	timer_name: { name: 'Timer name' },
	active_timer_id: { name: 'Timer id' },
	event_name: { name: 'Event name' },
	session_title: { name: 'Current session' },
	next_session: { name: 'Next session' },
	message: { name: 'Message showing (blank when none)' },
	blackout: { name: 'Blackout on (true or false)' },
	connected: { name: 'Connected to TimeDeck (true or false)' },
}

export function updateVariableDefinitions(self) {
	self.setVariableDefinitions(VARIABLES)
}

/** Variable values for a snapshot (see snapshot() in lib/timedeck-client.mjs). */
export function variableValues(s, online) {
	return {
		time: s.time,
		remaining_ms: s.remainingMs ?? s.ms ?? 0,
		status: s.status,
		phase: s.phase,
		timer_name: s.timerName || '',
		active_timer_id: s.timerId || '',
		event_name: s.eventName || '',
		session_title: s.sessionTitle || '',
		next_session: s.nextSession || '',
		message: s.message || '',
		blackout: !!s.blackout,
		connected: online !== false && !!s.connected,
	}
}
