const { InstanceBase, InstanceStatus, runEntrypoint } = require('@companion-module/base')
const { got } = require('got')

class NotionInstance extends InstanceBase {
	constructor(internal) {
		super(internal)

		this.NOTIONINFO_ACTIVE = false
		this.NOTIONINFO_DATABASEID = ''
		this.NOTIONINFO_START_TIME = 0
	}

	async init(config) {
		this.config = config

		this.updateStatus(InstanceStatus.Ok)

		this.updateActions()
	}

	async destroy() {
		this.log('debug', 'destroying')
		let self = this
		if (self.NOTIONINFO_ACTIVE === true) {
			const rightNow = Date.now()
			const isoDate = new Date(rightNow).toISOString()
			self.createMessage(rightNow, isoDate, 'stopped during destroy', Error().stack)
		}
		this.log('debug', 'destroyed')
	}

	async configUpdated(config) {
		this.config = config

		this.updateActions()
	}

	getConfigFields() {
		return [
			{
				type: 'static-text',
				id: 'info',
				width: 12,
				label: 'Information',
				value: 'Use this module to send timestamp information to Notion.',
			},
			{
				type: 'textinput',
				id: 'apiKey',
				label: 'Notion API Key',
				width: 12,
				required: true,
			},
			{
				type: 'textinput',
				id: 'parentPageId',
				label: 'Parent Page ID',
				width: 12,
				required: true,
			},
		]
	}

	updateActions() {
		let self = this
		let actionsArr = {
			['startSession']: {
				name: 'Start a Session',
				options: [
					{
						type: 'textinput',
						label: 'Database Name',
						id: 'databaseName',
						default: '',
					},
					{
						type: 'checkbox',
						id: 'autoCreateStartRecord',
						label: 'Automatically create start record?',
						default: false,
					},
				],
				callback: async (action, context) => {
					const rightNow = Date.now()
					const isoDate = new Date(rightNow).toISOString()
					let databaseName = await context.parseVariablesInString(action.options.databaseName.trim())
					await self.startSession(rightNow, isoDate, action.options.autoCreateStartRecord, databaseName)
				},
			},
			['createMarker']: {
				name: 'Create Marker',
				options: [
					{
						type: 'textinput',
						label: 'Message',
						id: 'message',
						default: '',
					},
				],
				callback: async (action, context) => {
					const rightNow = Date.now()
					const isoDate = new Date(rightNow).toISOString()
					let message = await context.parseVariablesInString(action.options.message.trim())
					await self.createMessage(rightNow, isoDate, message, '')
				},
			},
			['stopSession']: {
				name: 'Stop a Session',
				options: [],
				callback: async (action) => {
					const rightNow = Date.now()
					const isoDate = new Date(rightNow).toISOString()
					
					await self.stopSession(rightNow, isoDate)
				},
			}
		}

		this.setActionDefinitions(actionsArr)
	}

	async createMessage(rightNow, isoDate, message, logDetails) {
		let self = this
		if (self.NOTIONINFO_ACTIVE === false) {
			return
		}
		if (self.NOTIONINFO_START_TIME === 0) {
			self.NOTIONINFO_START_TIME = rightNow
		}

		const elapsedTime = rightNow - self.NOTIONINFO_START_TIME
		let seconds = Math.floor(elapsedTime / 1000)
		let minutes = Math.floor(seconds / 60)
		let hours = Math.floor(minutes / 60)

		seconds = seconds % 60
		minutes = minutes % 60

		let timestampFmt = ''
		if (hours !== 0) {
			timestampFmt =
				hours.toString().padStart(2, '0') +
				':' +
				minutes.toString().padStart(2, '0') +
				':' +
				seconds.toString().padStart(2, '0')
		} else {
			timestampFmt = '00:' + minutes.toString().padStart(2, '0') + ':' + seconds.toString().padStart(2, '0')
		}

		const body = {
			parent: {
				database_id: self.NOTIONINFO_DATABASEID,
			},
			properties: {
				message: {
					title: [
						{
							text: {
								content: message,
							},
						},
					],
				},
				companionTimeMillis: {
					number: rightNow,
				},
				companionTimeDate: {
					rich_text: [
						{
							text: {
								content: isoDate,
							},
						},
					],
				},
				elapsedTime: {
					number: elapsedTime,
				},
				timestampValue: {
					rich_text: [
						{
							text: {
								content: timestampFmt,
							},
						},
					],
				},
				loggingDetails: {
					rich_text: [
						{
							text: {
								content: logDetails,
							},
						},
					],
				},
			},
		}
		await self.doRestCall('https://api.notion.com/v1/pages', body, rightNow, isoDate, false)
	}

	async startSession(rightNow, isoDate, autoCreateStartRecord, databaseName) {
		let self = this
		if (self.NOTIONINFO_ACTIVE === true) {
			self.stopSession(rightNow, isoDate)
		}

		if (databaseName === '') {
			databaseName = isoDate
		}

		const body = {
			parent: {
				type: 'page_id',
				page_id: self.config.parentPageId.trim(),
			},
			title: [
				{
					type: 'text',
					text: {
						content: databaseName,
					},
				},
			],
			properties: {
				message: {
					title: {},
				},
				companionTimeMillis: {
					number: {},
				},
				companionTimeDate: {
					rich_text: {},
				},
				elapsedTime: {
					number: {},
				},
				timestampValue: {
					rich_text: {},
				},
				createTime: {
					created_time: {},
				},
				loggingDetails: {
					rich_text: {},
				},
			},
		}
		await self.doRestCall('https://api.notion.com/v1/databases/', body, rightNow, isoDate, autoCreateStartRecord)
	}

	async stopSession(rightNow, isoDate) {
		let self = this
		self.createMessage(rightNow, isoDate, 'stop', '')
		self.NOTIONINFO_ACTIVE = false
		self.NOTIONINFO_DATABASEID = ''
		self.NOTIONINFO_START_TIME = 0
	}

	async doRestCall(notionUrl, body, rightNow, isoDate, autoCreateStartRecord) {
		let self = this
		
		const options = {
			json: body,
			headers: {
				"Authorization": 'Bearer ' + self.config.apiKey.trim(),
				"Notion-Version": '2022-06-28',
				'Content-Type': 'application/json'
			},
			timeout: {
				request: 10000,
			}
		}
		try {
			const data = await got.post(notionUrl, options).json()
			if (data.object === 'database') {
				self.NOTIONINFO_DATABASEID = data.id
				self.NOTIONINFO_ACTIVE = true
				self.updateStatus(InstanceStatus.Ok)
				if (autoCreateStartRecord === true) {
					self.NOTIONINFO_START_TIME = rightNow
					self.createMessage(rightNow, isoDate, 'start', '')
				}
			} else if (data.object === 'error') {
				self.log('error', result.data.code + ' ' + result.data.message)
				self.status(self.UnknownError, result.data.status)
			}			
			else {
				self.updateStatus(InstanceStatus.Ok)
			}
			
		} catch (error) {
			if (error !== null) {
				self.log('error', `Notion Send Failed (${JSON.stringify(error)})`)
				self.updateStatus(InstanceStatus.UnknownError, error.code)
			}

			self.updateStatus(Instance.UnknownError, 'Unknown Error Sending to Notion')
		}
	}
}

runEntrypoint(NotionInstance, [])
