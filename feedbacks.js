// Button feedbacks. Colours follow TimeDeck's default canvas status colours
// so a button and the stage screen agree.

export const COLOURS = {
	normal: 0x22c55e,
	warning: 0xf5b54a,
	critical: 0xff5a4e,
	overtime: 0xb42318,
	black: 0x000000,
	white: 0xffffff,
	blue: 0x2563eb,
}

export function updateFeedbacks(self) {
	const s = () => self.state
	self.setFeedbackDefinitions({
		timer_phase: {
			type: 'boolean',
			name: 'Timer: is running / paused / idle / ended',
			defaultStyle: { bgcolor: COLOURS.normal, color: COLOURS.black },
			options: [
				{
					type: 'dropdown',
					id: 'phase',
					label: 'When the timer is',
					default: 'running',
					choices: [
						{ id: 'running', label: 'Running' },
						{ id: 'paused', label: 'Paused' },
						{ id: 'idle', label: 'Not started' },
						{ id: 'ended', label: 'Ended' },
						{ id: 'waiting', label: 'Waiting for its scheduled start' },
					],
				},
			],
			callback: (fb) => s().phase === fb.options.phase,
		},
		timer_status: {
			type: 'boolean',
			name: 'Timer: status is normal / warning / critical / overtime',
			defaultStyle: { bgcolor: COLOURS.critical, color: COLOURS.white },
			options: [
				{
					type: 'dropdown',
					id: 'status',
					label: 'When the status is',
					default: 'critical',
					choices: [
						{ id: 'normal', label: 'Normal' },
						{ id: 'warning', label: 'Warning' },
						{ id: 'critical', label: 'Critical' },
						{ id: 'overtime', label: 'Overtime' },
					],
				},
			],
			callback: (fb) => s().phase !== 'idle' && s().status === fb.options.status,
		},
		status_colours: {
			type: 'advanced',
			name: 'Timer: colour the button by status',
			description: 'Green, amber, red, dark red for overtime; grey while not started',
			options: [],
			callback: () => {
				const st = s()
				if (!st.connected) return { bgcolor: 0x3f3f46, color: COLOURS.white }
				if (st.phase === 'idle') return { bgcolor: 0x27272a, color: COLOURS.white }
				const bg = COLOURS[st.status] ?? COLOURS.normal
				return { bgcolor: bg, color: st.status === 'warning' || st.status === 'normal' ? COLOURS.black : COLOURS.white }
			},
		},
		blackout_on: {
			type: 'boolean',
			name: 'Screens: blackout is on',
			defaultStyle: { bgcolor: COLOURS.white, color: COLOURS.black },
			options: [],
			callback: () => !!s().blackout,
		},
		message_showing: {
			type: 'boolean',
			name: 'Message: a message is showing',
			defaultStyle: { bgcolor: COLOURS.blue, color: COLOURS.white },
			options: [],
			callback: () => !!s().message,
		},
		disconnected: {
			type: 'boolean',
			name: 'Connection: TimeDeck is unreachable',
			defaultStyle: { bgcolor: 0x3f3f46, color: COLOURS.white },
			options: [],
			callback: () => self.online === false,
		},
	})
}
