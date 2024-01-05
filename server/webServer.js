"use strict";

const Vimeo = require('vimeo').Vimeo;
const fs = require('fs');
const express = require('express');
const app = express();
const brotli = require('brotli');
// HTTPS
const https = require('https');
let pref = {};
try {
	let prefFileName = 'preferences.json';
	if (process.argv.length > 2) {
		prefFileName = process.argv[2];
		console.log('using preferences file:', process.argv[2]);
	}
  if (fs.existsSync(prefFileName)) {
		let prefData = fs.readFileSync(prefFileName);
		pref = JSON.parse(prefData);
} else {console.error("Can not find preferences file: "+prefFileName); process.exit(1)}
	if (!pref.colors) pref.colors = [10027008, 5019904, 39065, 4980889];
	if (!pref.defaultPort) pref.defaultPort = 8443;
	if (!pref.rootDir) pref.rootDir = '../client';
} catch(err) {
  console.error(err);
}
var serverPref = {};
if (pref.pemKey) serverPref.key = fs.readFileSync(pref.pemKey);
if (pref.pemCert) serverPref.cert = fs.readFileSync(pref.pemCert);
if (pref.pemCA) serverPref.ca = fs.readFileSync(pref.pemCA);
console.log(serverPref);
const httpsServer = https.createServer(serverPref, app);
const nodemailer = require("nodemailer")
const io = require('socket.io')(httpsServer);
const port = process.env.PORT || pref.defaultPort;
const rootDir = process.env.ROOT_DIR || pref.rootDir;
const cookieParser = require('cookie-parser');
app.use(cookieParser());
app.use(express.json());

// Scan for compressible files before starting web server. This will take a while the first time
let compressibleContentTypes = {};
if (pref.useCompressed) {
	compressibleContentTypes = pref.compressibleContentTypes;
  scanCompressibleFiles();
}

let userMap = {};
let anchorMap = {};
let userNames = {};
let userUUID = 0;
let globalSocket = null;

var bc = {utils:{}, world:{childMap:{'_global':{childMap:{}}}}};
var options = {root: rootDir};
// This is a temporary solution to give unique colors to avatars
var nextColor = 0;
var colors = pref.colors;
var users = [];
let userCount = 0;

function generateUUID(a)
	{return a ? (a ^ ((Math.random() * 16) >> (a / 4))).toString(16) : ([1e7] + -1e3 + -4e3 + -8e3 + -1e11).replace(/[018]/g, generateUUID)}
// Builds an anchor if not found and adds user
function addAnchorUser(userId, anchorId, type) {
	let anchor = anchorMap[anchorId];
	if (!anchor) anchor = anchorMap[anchorId] = {type:type, userCount:0, userMap:{}};
	if (anchor.userMap[userId]) {console.error('addAnchorUser - User '+userId+' in Anchor '+anchorId+' Already.')}
	else {
		userMap[userId].anchorMap[anchorId] = anchor;
		anchor.userCount++;
		anchor.userMap[userId] = userMap[userId];
		let map = anchor.userMap;
		for (let id in map) {
			if (id != userId) {map[id].socket.emit('addAnchorUser', {userId:userId, anchorId:anchorId})}
		}
	}
	return anchor;
}
// Removes user.  If no users then removes anchor.
function removeAnchorUser(userId, anchorId) {
	let anchor = anchorMap[anchorId];
	if (anchor) {
		let map = anchor.userMap[userId];
		if (map) {
			delete anchor.userMap[userId];
			delete userMap[userId].anchorMap[anchorId];
			if (!--anchor.userCount) {delete anchorMap[anchorId]}
			else {
				let map = anchor.userMap;
				for (let id in map) {
					if (id != userId) {
						map[id].socket.emit('removeAnchorUser', {userId:userId, anchorId:anchorId})
					}
				}
			}
		}
		else {console.error('removeAnchorUser - User '+userId+' in Anchor '+anchorId+' Not present')}
	}
	else {console.error('removeAnchorUser - User '+userId+' in Anchor '+anchorId+' Not present')}
}
io.on('connection', (socket) =>
{
	let userId = 'User'+userUUID;
	// It's a little slower than hashing socket.id but we get
	// a nice index for each user that can be used for uniqueness
	// on the client side.
	userMap[userId] = {userId:userId, uuid:userUUID++, socket:socket, instance:0, anchorMap:{}};
	userCount++;

	socket.on('newUserRequest', (inMessage)=>{
		socket.emit('response', {uuid:inMessage.uuid, userId:userId});
	});
	socket.on('close', (reason)=>{
		console.log('Socket was closed by:'+userId)
	});
	socket.on('disconnect', (reason) => {
		let user = userMap[userId];

		// Remove the user from the current environment (anchor)
console.log('Disconnect user:'+userId+' userCount:'+userCount+' open anchors:', Object.keys(anchorMap));
		let map = userMap[userId].anchorMap;
		for (let anchorId in map) {
			let anchor = map[anchorId];
			if (anchor.type == 'env') {
				let uMap = anchor.userMap;
				for (let uId in uMap) {
					if (uId !== userId) uMap[uId].socket.emit('resourceUnanchorRequest', {uuid:0, anchorId:anchorId, userId:userId})}
			}
			removeAnchorUser(userId, anchorId);
		}
		delete userMap[userId];
		userCount--;
	});
	let req = socket.request;
	console.log(userId+ ' connected from ' + normalizeIp(socket.handshake.address));
	console.log(req.headers['user-agent']);
	socket.on('chat', (from, msg) => {console.log({timestamp: new Date(),from: from,msg: msg})});
	socket.on('im-alive', (from, msg) => {console.log('Got im-alive from ' + from + ', msg=' + msg)});
	socket.on('console', (payload) => {console.log('log IP ' + normalizeIp(socket.handshake.address) + ' - ' + payload)});
	socket.on('joinAnchorRequest', (inMessage)=>{
		const userMap = addAnchorUser(userId, inMessage.anchorId, 'world').userMap;
		let users = [];
		for (let key in userMap) {
			users.push(userMap[key].userId);
		}
		socket.emit('response', {uuid:inMessage.uuid, userId:userId, users:users});
	});
	socket.on('leaveAnchorRequest', (inMessage)=>{
		removeAnchorUser(userId, inMessage.anchorId);
		socket.emit('response', {uuid:inMessage.uuid, userId:userId});
	});
	socket.on('lockAnchorRequest', (inMessage)=>{
		let anchor = anchorMap[inMessage.anchorId];
		let lockUserId;
		if (anchor) {
			let users = Object.keys(anchor.userMap);
			lockUserId = users[0];
		}
		else {
			addAnchorUser(userId, inMessage.anchorId, 'world')
			lockUserId = userId;
		}
console.log('lock anchorId:', inMessage.anchorId, ' lockUserId:', lockUserId);
		socket.emit('response', {uuid:inMessage.uuid, userId:lockUserId});
	});
	socket.on('unlockAnchorRequest', (inMessage)=>{
		let anchor = anchorMap[inMessage.anchorId];
		if (!anchor) {console.error('unlockAnchor no anchor:', inMessage.anchorId); return}
		removeAnchorUser(userId, inMessage.anchorId);
console.log('unlock anchorId:', inMessage.anchorId, ' lockUserId:', userId);
		socket.emit('response', {uuid:inMessage.uuid, userId:userId});
	});
	socket.on('statusAnchorRequest', (inMessage)=>{
		userMap[userId].worldAnchorId = inMessage.anchorId;
		let userCount = 0;
		let channel = anchorMap[inMessage.anchorId];
		if (channel) userCount = channel.userCount;
		socket.emit('response', {uuid:inMessage.uuid, userId:userId, userCount:userCount});
	});
	socket.on('createMessageRequest', (inMessage)=>{
		let uuid = generateUUID();
		let userDirName = inMessage.user.replace('@','_AT_');
		let messagePath = 'data/users/active/'+userDirName+'/messages/'+uuid;
console.log('createMessageRequest - messagePath'+messagePath);
		fs.writeFileSync(messagePath, inMessage.data);
		socket.emit('response', {uuid:inMessage.uuid, status:'Saved!'});
	});
	socket.on('messageDataRequest', (inMessage)=>{
		let uuid = inMessage.messageUUID;
		let user = inMessage.user;
		let userDirName = inMessage.user.replace('@','_AT_');
		let userDir = "data/users/active/"+userDirName;
		let messagePath = userDir+'/messages/'+uuid;
		console.log('messageRequest - messagePath:'+messagePath);
		let data = fs.readFileSync(messagePath, 'UTF8');
		socket.emit('response', {uuid:inMessage.uuid, data:data});
	});
	socket.on('loginRequest', (inMessage)=>{
		let user = inMessage.user;
		let password = inMessage.password;
		let data = inMessage.data;
		let mode = inMessage.mode;
		let userDirName = inMessage.user.replace('@','_AT_');
		let envDir = "../client/assets/environments";
		let userDir = "data/users/active/"+userDirName;
		let accessFile = userDir+'/'+'access.csv';
		let dataFile = userDir+'/'+'data.json';
		let userDirExists = fs.existsSync(userDir);
		if (!userDirExists && mode == 'test') {
			socket.emit('response', {uuid:inMessage.uuid, status:'NewUser'}) }
		else {
			if (mode == 'create') {
				fs.mkdirSync(userDir);
				fs.mkdirSync(userDir+'/messages');
				let records = [];
				records.push('User,Password');
				records.push(user+','+inMessage.password);
				fs.writeFileSync(accessFile, records.join('\n'));
			}
			let accessData = fs.readFileSync(accessFile, 'UTF8');
			let records = accessData.split('\n');
			let record = records[1].split(',');
			let oldPassword = record[1];
			let status = 'Success';
			if (oldPassword == 'Password_Reset') {
				record[1] = password;
				records[1] = record.join(',');
				fs.writeFileSync(accessFile, records.join('\n')) }
			else if (oldPassword != password) {status = 'PasswordFail'}
			let token = 'H'+Math.floor(Math.random() * 1000000000);
			addAnchorUser(userId, token, 'user').userEmail = inMessage.user;
			let messageData = [];
			let envRecords = [];
			if (status == 'Success') {
				if (data) {fs.writeFileSync(dataFile, data)}
				if (fs.existsSync(dataFile)) {data = fs.readFileSync(dataFile, 'UTF8')}
				fs.readdirSync(userDir+'/messages').forEach(file => {
					messageData.push({messageUUID:file});
				});
				fs.readdirSync(envDir).forEach(file=>{
					let stats = fs.statSync(envDir + "/" + file);
					if (stats.isDirectory()) {
						envRecords.push({name:file});
					}
				})
			}
			else {data = ''};
			socket.emit('response', {uuid:inMessage.uuid, token:token, document:data, messages:messageData, environments:envRecords, status:status});
		}
	});
	socket.on('updateResource', (inMessage)=>{
		const url = inMessage.url;
		const data = inMessage.data;
		if (!/data:image\//.test(data)) {
			console.log('ImageDataURI :: Error :: It seems that it is not an Image Data URI. Couldn\'t match "data:image\/"');
			return null;
		}

		let regExMatches = data.match('data:(image/.*);base64,(.*)');
		const imageType = regExMatches[1];
		const dataBase64 = regExMatches[2];
		const dataBuffer = new Buffer(regExMatches[2], 'base64');
		const path = rootDir + url;
		console.log('url:', path);
		fs.writeFileSync(path, dataBuffer);
	});
	socket.on('direct', (inMessage)=>{
		let toUserId = inMessage.toUserId;
console.log('direct - targeting user:', toUserId);
		let toUser = userMap[toUserId];
		if (!toUser) {socket.emit('directResponse', {error:'No User Target Found '+toUserId})}
		else {toUser.socket.emit('directRequest', inMessage)}
	});
	// Send a message directly to a user but then wait for a response on the client side
	socket.on('directRequest', (inMessage)=>{
		let toUserId = inMessage.toUserId;
console.log('directRequest - targeting user:', toUserId);
		let toUser = userMap[toUserId];
		if (!toUser) {socket.emit('directResponse', {error:'No User Target Found '+toUserId})}
		else {toUser.socket.emit('directRequest', inMessage)}
	});
	// A response from a directRequest
	socket.on('directResponse', (inMessage)=>{
		let toUserId = inMessage.toUserId;
console.log('directResponse - targeting user:', toUserId);
		let toUser = userMap[toUserId];
		if (!toUser) {socket.emit('directResponse', {error:'No User Target Found '+toUserId})}
		else {toUser.socket.emit('directResponse', inMessage)}
	});
	socket.on('broadcast', (inMessage)=>{
		if (userMap[userId]) {
			let anchor = anchorMap[inMessage.anchorId];
			if (anchor) {
				let map = anchor.userMap;
				for (let id in map) {
					if (id != userId) {
						map[id].socket.emit('broadcast', inMessage);
					}
				}
			}
		} else {
			console.error('broadcast - User '+userId+' not found.');
		}
	});
	socket.on('updateStatic', (inMessage)=>{
			console.log('Updating static scene:', inMessage.sceneId);
			let uuid = 'Static';
			let basePath = "data/worlds/";
			let baseDir = basePath+uuid;
			if (!fs.existsSync(baseDir)) {fs.mkdirSync(baseDir)}
			fs.writeFile(baseDir+'/'+inMessage.sceneId+'.js', inMessage.anchorDocument, (err) => {if(err) {throw err}});
	});
	socket.on('updateHelp', (inMessage)=>{
			let baseDir = "../client/assets/help";
			if (!fs.existsSync(baseDir)) {fs.mkdirSync(baseDir)}
			fs.writeFile(baseDir+'/'+inMessage.fileName, inMessage.anchorDocument, (err) => {if(err) {throw err}});
	});
	socket.on('sendMailRequest', (inMessage)=>{
		let m = inMessage;
		let user = m.user;
		let password = m.password;
		if (m.user == 'public') {
			user = 'user@yourdomain.com';
			password = 'yourpassword';
		}
		async function sendMail() {
			var transporter = nodemailer.createTransport({
				host: m.host,
				port: m.port,
				secure: m.secure,
				auth:{
					user: user,
					pass: password
				}
			});
			let info = await transporter.sendMail({
				from: m.from,
				to: m.to,
				subject: m.subject,
				text: m.text,
				html: m.body
			})
			socket.emit('response', {uuid:inMessage.uuid, in:inMessage, response:'Success!!'});
		}
		sendMail().catch((err)=>{socket.emit('response', {uuid:inMessage.uuid, in:inMessage, response:err})});
	});

  socket.on('response', (inMessage)=>{
		// Send the enter response from a user to the
		// user that requested it.
		let userId = inMessage.userId;
		let socket = userMap[userId].socket;
		socket.emit('response', inMessage);
	});
	// DEPRECATED.  This should be broken into joinAnchorRequest and anchorResourceRequest.
	socket.on('resourceAnchorRequest', (inMessage) => {
		// Request to be attached to an anchor
		let anchor = addAnchorUser(userId, inMessage.anchorId, 'env');
		let parts = inMessage.anchorId.split('-');
		let envType = parts[0];
		let basePath = "data/worlds/";
		let uuid = parts[1];
		let baseDir = basePath+uuid;
		let filePath = baseDir+'/'+envType+'.js';
		const userKeys = [];
		for (let key in anchor.userMap) {if (key != userId) userKeys.push(key)}
		inMessage.userKeys = userKeys;
		// If it's the first user then load from disk
		// else ask a user in the environment for the design.
		if (anchor.userCount == 1) {
			// If first user then then load it from disk
			if (!fs.existsSync(filePath)) {
				// Load new instance from Static world
				baseDir = basePath+'Static'
			}
			filePath = baseDir+'/'+envType+'.js';
			if (fs.existsSync(filePath)) {
console.log('reading filePath:', filePath);
				let contents = fs.readFileSync(filePath, 'UTF8');
				let document = contents;
				inMessage.anchorDocument = document;
			}
		}
		socket.emit('response', inMessage);
//			anchor.userMap[userKeys[0]].socket.emit('anchorRequest', inMessage);
	});
	socket.on('resourceUnanchorRequest', (inMessage)=>{
		// Static world never gets overwritten.
console.log('unAnchorRequest user:'+inMessage.userId);
		let parts = inMessage.anchorId.split('-');
		let uuid = parts[1];
		if (uuid != 'Static' && pref.saveWorldInstances) {
			let envType = parts[0];
			let basePath = "data/worlds/";
			let baseDir = basePath+uuid;
			if (!fs.existsSync(baseDir)) {fs.mkdirSync(baseDir)}
			fs.writeFile(baseDir+'/'+envType+'.js', inMessage.anchorDocument, (err) => {if(err) {throw err}});
		}
		let map = userMap[userId].anchorMap;

		let anchorId = inMessage.anchorId;
		console.log('resourceUnanchorRequest removeUser - userId', userId, ' anchorId:', anchorId);
		removeAnchorUser(userId, anchorId);
		socket.emit('response', inMessage);
	});
	socket.on('fileRequest', (path) => {
		let filePath = rootDir + '/' + path;
		fs.stat(filePath, (err, stats) => {
			let bytesRemaining = stats.size;
			let readable = fs.createReadStream(filePath);
			readable.on('readable', () => {
				let chunk;
				while((chunk = readable.read(8192)) !== null) {
					bytesRemaining -= chunk.length;
					socket.emit('fileData', ({ path: path, remaining: bytesRemaining, data: chunk }));
				}
			});
		});
	});
});
app.get('/', (req, res, next) => {
	req.url = '/index.html';
	doCookies(req, res);
	sendFile(req, res, next);
});
app.get('/nft/cmd.html', (req, res, next)=>{
	console.log('nft found!!');
	let token = req.query.token;
	let action = req.query.action;
	if (anchorMap[token]) {
		if (action == 'Password_Reset') {
			// Set password to Password_Reset
			let userEmail = anchorMap[token].userEmail;
			console.log('sending reset anchorMap:'+userEmail);
			res.sendFile('data/pages/reset.html', {root: rootDir}, (err) => {console.error(err)});
			let userDirName = userEmail.replace('@','_AT_');
			let accessFile = "data/users/active/"+userDirName+'/access.csv';
console.log('Opening '+accessFile);
		 	let contents = fs.readFileSync(accessFile, 'UTF8');
			let records = contents.split('\n');
			let record = records[1].split(',');
			record[1] = 'Password_Reset';
			records[1] = record.join(',');
			fs.writeFile(accessFile, records.join('\n'), (err)=>{if(err) {throw err}});
		}
	}
	else {res.sendFile('data/pages/tokenFail.html', {root: rootDir}, (err) => {console.error(err)}) }
	console.log('token:'+ token);
	console.log('action:'+ action);
});
app.get('/js/docXR.js', (req, res, next)=>{
	if (pref.useMinify) {
		let index = req.url.lastIndexOf('.');
		let url = req.url.substr(0, index) + '.min' + req.url.substr(index);
 		req.url = url;
console.log('Changing to Minify:', req.url);
	}
	sendFile(req, res, next)
});
app.get('/js/docXRScript.js', (req, res, next)=>{
	if (pref.useMinify) {
		let index = req.url.lastIndexOf('.');
		let url = req.url.substr(0, index) + '.min' + req.url.substr(index);
 		req.url = url;
console.log('Changing to Minify:', req.url);
	}
	sendFile(req, res, next)
});
// Access test environment where recoder puts environment code.
app.get('/static/*.html', (req, res, next) => {
	let options = {
		root: rootDir
	};
	let sendUrl = 'data/worlds/Static/' + req.url.substr(9);
	doCookies(req, res);
	res.sendFile(sendUrl, options, (err) => {
		if(err) {
			console.log('Failed to send file ' + sendUrl);
			console.log(err);
			next(err);
		}
	})
});
app.get('/*.html', (req, res, next) => {
console.log('html found ', req);
	doCookies(req, res); sendFile(req, res, next)
});
app.get('/*.csv', (req, res, next) => {doCookies(req, res); sendFile(req, res, next)});
app.get('/*.css', (req, res, next) => {sendFile(req, res, next)});
app.get('/js/*', (req, res, next) => {console.log("path:",req.path);sendFile(req, res, next)});
app.get('/assets/*', (req, res, next) => {sendFile(req, res, next)});
app.get('/concepts/*', (req, res, next) => {sendFile(req, res, next)});
app.get('/favicon.ico', (req, res, next) => {res.sendFile(req.url, {root: rootDir}, (err) => {if(err)next(err)})});
app.get('/me', (req, res) => {
	res.send('<h2>Headers:</h2>' + JSON.stringify(req.headers) + '<h2>IP:</h2>' + req.ip);
});
app.get('/googlesheets/*', (req, res) => {
  var driveID = req.originalUrl.split('/googlesheets/')[1];
  googleAPI.getSpreadsheet(driveID, function(csv){
    // console.log(csv);
    res.send(csv);
  });
  // console.log(csv);
})
app.post('/moved', (req, res) => {
	console.log('POST moved:');
	var location = req.body;
	console.log(location);
	res.send("OK");
});
app.post('/console', (req, res) => {
	console.log(req.body);
	res.send('OK');
});
app.get('/vimeo/api', (request, response) => {
console.log('Vimeo Request:'+request.query.path);
//let api = new Vimeo(null, null, process.env.VIMEO_TOKEN);
	let api = new Vimeo('06834719a7c979ff909ae2694f78638b6d5f8a0c',
	                    'vJTzDgJq9EPDGjx9tEtlq4cwEsC/yl1DrR35dyvbOjrFnjasltXqMGtH17X48FFu5H4MzAlkRQ5z3Ex68Ec9coNH3yQ06avz+iyZ9UlLxhdI7nDuOjdn4OEMyBF8k1CR',
	                    '675363f7d25e5363fe554386c8f55e1e');
	api.request({
			method: 'GET',
			path: request.query.path,
			headers: { Accept: 'application/vnd.vimeo.*+json;version=3.4' },
		},
		function(error, body, status_code, headers) {
			if (error) {
				response.status(500).send(error);
				console.log('[Server] ' + error);
			} else {
				// Pass through the whole JSON response
console.log('/vimeo/api - response:', body);
				response.status(200).send(body);
			}
		}
	);
});
httpsServer.listen(port, () => {
	if(!process.env.PORT) {
		console.log('Environment variable PORT not defined, defaulting to ' + port);
	} else {
		console.log('PORT=' + process.env.PORT);
	}
	if(!process.env.ROOT_DIR) {
		console.log('Environment variable ROOT_DIR not defined, defaulting to \'' + rootDir + '\'');
	} else {
		console.log('ROOT_DIR=' + process.env.ROOT_DIR);
	}
	console.log(`Listening on port ${port}...`);
});

function normalizeIp(ip) {
	if(ip === '::1') {
		return 'localhost';
	}
	let colon = ip.lastIndexOf(':');
	if(colon >= 0) {
		ip = ip.substring(colon + 1);
	}
	return ip;
}

function sendFile(req, res, next) {
	let options = {
		root: rootDir
	};
	// console.log('Requested ' + req.url);
	let extension = '';
	let here = req.path.lastIndexOf('.');
	if(here >= 0) {
		extension = req.path.substring(here).toLowerCase();
	}
	let relative = req.path;
	if(compressibleContentTypes[extension]) {
		let path = rootDir + req.path;
		let compressionType;
		let origStats = fs.statSync(path);
		if(fs.existsSync(path + '.br')) {
			compressionType = 'br';
			let compressedStats = fs.statSync(path + '.br');
			if(origStats.mtimeMs > compressedStats.mtimeMs) {
				// Original file is newer, recreate the compressed file
				console.log('Uncompressed newer, recompressing file ' + path);
				compressFile(path, compressionType);
			}
		} else if(fs.existsSync(path + '.gz')) {
			compressionType = 'gz';
		} else {
			compressionType = 'br';
			compressFile(path, compressionType);
		}
		if(compressionType) {
			relative = req.path + '.' + compressionType;
			let headers = {
				'Content-Encoding': compressionType,
				'Content-Type': compressibleContentTypes[extension]
			};
			options.headers = headers;
			// console.log('Using compressed file ' + relative);
		}
	}
	res.sendFile(relative, options, (err) => {
		if(err) {
			console.log('Failed to send file ' + relative);
			console.log(err);
			next(err);
		}
	})
}

function doCookies(req, res) {
	// Set the user name if not already set in the cookie
	// console.log('Cookies:');
	// console.log(req.cookies);
/*
	if(!req.cookies || !req.cookies.avatarName)	{
		// No cookie set, pick the next available user name
		var usersFile = 'userNames.json';
		fs.readFile(usersFile, 'utf8', (err, contents) =>	{
			if(err)	{
				console.log('Missing required file: ' + usersFile);
				throw err;
			}
			userNames = JSON.parse(contents);
			for(var name in userNames) {
				if(!userNames[name]) {
					userNames[name] = true;
					res.cookie('avatarName', name, { maxAge: 7776000000 });		 // 90 days
					console.log('Cookie avatarName not set, setting to ' + name);
					fs.writeFile(usersFile, JSON.stringify(userNames), (err) => {
						if(err) {
							throw err;
						}
						console.log('Saved file: ' + usersFile);
					});
					break;
				}
			}
		});
	}
	else {
		console.log('IP ' + req.ip + ' has avatar name ' + req.cookies.avatarName);
	}
*/
}

function scanCompressibleFiles() {
	let startMs = new Date().getTime();
	console.log('Scanning for files to compress...');
	findFiles(rootDir+'/assets');
	let diffMs = new Date().getTime() - startMs;
	console.log('Scanning done, took ' + diffMs + ' ms');
	console.log('');
}

function findFiles(dir) {
	let files = fs.readdirSync(dir);
	if(files) {
		for(let i = 0; i < files.length; i++) {
			checkFile(dir, files[i]);
		}
	} else {
		console.error('Reading directory ' + path + ' failed');
	}
}

function checkFile(dir, file) {
	let path = dir + '/' + file;
	let stats = fs.statSync(path);
	let isDir = stats.isDirectory();
	if(isDir) {
		findFiles(path);
	} else {
		let here = file.lastIndexOf('.');
		if(here >= 0) {
			let extension = file.substring(here).toLowerCase();
			if(compressibleContentTypes[extension]) {
				checkCompressedFile(path, 'br');
				// checkCompressedFile(path, 'gz');
			}
		// } else {
			// console.warn('No file extension found for ' + path);
		}
	}
}

function checkCompressedFile(file, compressionType) {
	let compressedFile = file + '.' + compressionType;
	if(!fs.existsSync(compressedFile)) {
		compressFile(file, compressionType);
	} else {
		// Check modification times should match
		let origStats = fs.statSync(file);
		let compressedStats = fs.statSync(compressedFile);
		if(origStats.mtimeMs > compressedStats.mtimeMs) {
			console.log('Recompressing file for: ' + file);
			compressFile(file, compressionType);
		}
	}
}

function compressFile(file, compressionType) {
	let compressedFile = file + '.' + compressionType;
	try {
		if(fs.existsSync(compressedFile)) {
			fs.unlinkSync(compressedFile);
		}
		let binary;
		if(compressionType == 'br') {
			binary = brotli.compress(fs.readFileSync(file), {
		  	mode: 0,     // 0 = generic, 1 = text, 2 = font (WOFF2)
		  	quality: 11, // 0 - 11
		  	lgwin: 22    // window size
			});
		} else if(compressionType == 'gz') {
			console.warn('Gzip compression not yet implemented');
			// TODO: Implement
		}
		fs.writeFileSync(compressedFile, binary);
		// Set the modified time to be the same as original file, not sure it actually works
		let origStats = fs.statSync(file);
		//fs.utimesSync(compressedFile, origStats.atimeMs, origStats.mtimeMs);

	  //fs.utimesSync(compressedFile, origStats.atimeMs, origStats.mtimeMs);
		let compressedStats = fs.statSync(compressedFile);
		// if(origStats.mtimeMs != compressedStats.mtimeMs) {
		// 	console.log('Timestamps don\'t match: orig=' + origStats.mtimeMs + ', comp=' + compressedStats.mtimeMs);
		// }
		let percentSize = compressedStats.size / origStats.size * 100.0;
		console.log('Compressed file %s is %f%% of original', file, Math.round(percentSize * 10.0) / 10.0);
	} catch (e) {console.error('Can not compress file:'+compressedFile+' error:'+e)}
}
