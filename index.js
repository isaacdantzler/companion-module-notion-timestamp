var instance_skel = require('../../instance_skel');
var debug;
var log;

function instance(system, id, config) {
	var self = this;

	// super-constructor
	instance_skel.apply(this, arguments);

	return self;
}

instance.prototype.NOTIONINFO_ACTIVE = false;
instance.prototype.NOTIONINFO_DATABASEID = '';
instance.prototype.NOTIONINFO_START_TIME = 0;

instance.prototype.updateConfig = function(config) {
	var self = this;

	self.config = config;

	self.actions();
}

instance.prototype.init = function() {
	var self = this;

	self.status(self.STATE_OK);

	debug = self.debug;
	log = self.log;
	
	self.actions(); // export actions
}

// Return config fields for web config
instance.prototype.config_fields = function () {
	var self = this;
	return [
		{
			type: 'text',
			id: 'info',
			width: 12,
			label: 'Information',
			value: 'Use this module to send timestamp information to Notion.'
		},
		{
			type: 'textinput',
			id: 'apiKey',
			label: 'Notion API Key',
			width: 12,
			required: true
		},
		{
			type: 'textinput',
			id: 'parentPageId',
			label: 'Parent Page ID',
			width: 12,
			required: true
		}
	]
}

// When module gets deleted
instance.prototype.destroy = function() {
	var self = this;
	if(self.NOTIONINFO_ACTIVE === true) {
		const rightNow = Date.now();
		const isoDate = new Date(rightNow).toISOString();
		self.createMessage(rightNow, isoDate,'stopped during destroy',Error().stack);	
	}
	debug("destroy");
}

instance.prototype.actions = function(system) {
	var self = this;

	self.setActions({
		'startSession': {
			label: 'Start a Session',
			options: [
				{
					type: 'textinput',
					label: 'Database Name',
					id: 'databaseName',
					default: ''
				},
				{
					type: 'checkbox',
					id: 'autoCreateStartRecord',
					label: 'Automatically create start record?',
					default: false
				}
			]
		},
		'createMarker': {
			label: 'Create Marker',
			options: [
				{
					type: 'textinput',
					label: 'Message',
					id: 'message',
					default: ''
				}
			]
		},
		'stopSession': {
			label: 'Stop a Session'
		}
	});
}

instance.prototype.action = function(action) {
	var self = this;
	const rightNow = Date.now();
	const isoDate = new Date(rightNow).toISOString();
	
	switch(action.action) {
		case 'startSession':
			self.startSession(rightNow, isoDate, action.options.autoCreateStartRecord, action.options.databaseName.trim());
			break;
		case 'stopSession':
			self.stopSession(rightNow, isoDate);
			break;
		case 'createMarker':
			self.createMessage(rightNow, isoDate, action.options.message.trim(),'');
			break;
		default:
			break;
	};
}

instance.prototype.createMessage = function(rightNow, isoDate, message, logDetails) {
	let self = this;
	if(self.NOTIONINFO_ACTIVE === false) {
		return;
	}
	if(self.NOTIONINFO_START_TIME === 0) {
		self.NOTIONINFO_START_TIME = rightNow;
	}

	const elapsedTime = rightNow - self.NOTIONINFO_START_TIME;
	let seconds = Math.floor(elapsedTime / 1000);
	let minutes = Math.floor(seconds / 60);
	let hours = Math.floor(minutes / 60);

	seconds = seconds % 60;
	minutes = minutes % 60;

	let timestampFmt = "";
	if(hours !== 0) {
		timestampFmt = hours.toString().padStart(2,'0')+":"+minutes.toString().padStart(2,'0')+":"+seconds.toString().padStart(2,'0');		
	} else {
		timestampFmt = minutes.toString().padStart(2,'0')+":"+seconds.toString().padStart(2,'0');
	}
	
	body = JSON.stringify({
		parent: {
			database_id: self.NOTIONINFO_DATABASEID
		},
		properties: {
			message: {
				title:[{
					text: {
						content:message
					}
				}],
			},
			companionTimeMillis: {
				number: rightNow
			},
			companionTimeDate: {
				rich_text:[{
					text: {
						content: isoDate
					}
				}]
			},
			elapsedTime: {
				number: elapsedTime
			},
			timestampValue: {
				rich_text:[{
					text: {
						content: timestampFmt
					}
				}]
			},
			loggingDetails: {
				rich_text:[{
					text: {
						content: logDetails
					}
				}]
			}
		}
	});
	self.doRestCall('https://api.notion.com/v1/pages',body, rightNow, isoDate, false);
}

instance.prototype.startSession = function(rightNow, isoDate, autoCreateStartRecord, databaseName) {
	let self = this;

	if(self.NOTIONINFO_ACTIVE === true) {
		self.stopSession(rightNow,isoDate);
	}

	if(databaseName === '') {
		databaseName = isoDate;
	}

	body = JSON.stringify({
		parent: {
			type:"page_id",
			page_id: self.config.parentPageId.trim(),
		},
		title:[{
			type:"text",
			text:{
				content:databaseName
			}
		}],
		properties: {
			message: {
				title:{}
			},
			companionTimeMillis: {
				number:{}
			},
			companionTimeDate: {
				rich_text:{}
			},
			elapsedTime: {
				number:{}
			},
			timestampValue: {
				rich_text:{}
			},
			createTime: {
				created_time:{}
			},
			loggingDetails: {
				rich_text:{}
			}
		}
	});
	self.doRestCall('https://api.notion.com/v1/databases/', body, rightNow, isoDate, autoCreateStartRecord);
}

instance.prototype.stopSession = function(rightNow, isoDate) {
	let self = this;
	self.createMessage(rightNow, isoDate, 'stop', '');
	self.NOTIONINFO_ACTIVE = false;
	self.NOTIONINFO_DATABASEID = '';
	self.NOTIONINFO_START_TIME = 0;
}

instance.prototype.doRestCall = function(notionUrl, body, rightNow, isoDate, autoCreateStartRecord) {
	let self = this;

	var extra_headers = [];
	extra_headers['Authorization'] = 'Bearer ' + self.config.apiKey.trim();
	extra_headers['Notion-Version'] = '2022-02-22';

	self.system.emit('rest', notionUrl, body, function (err, result) {
		if (err !== null) {
			self.log('error', 'Notion Send Failed (' + result.error.code + ')');
			self.status(self.STATUS_ERROR, result.error.code);
		} else if(result.data.object === 'error') {
			self.log('error',result.data.code + ' ' + result.data.message)
			self.status(self.STATUS_ERROR, result.data.status);
		} else if(result.data.object === 'database') {
			self.NOTIONINFO_ACTIVE = true;
			self.NOTIONINFO_DATABASEID = result.data.id;
			self.status(self.STATUS_OK);
			if(autoCreateStartRecord === true) {
				self.NOTIONINFO_START_TIME = rightNow;
				self.createMessage(rightNow, isoDate, 'start', '');
			}
		} else {
			self.status(self.STATUS_OK);
		}
	},extra_headers);
}

instance_skel.extendedBy(instance);
exports = module.exports = instance;