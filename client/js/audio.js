/*
 *  Copyright (c) 2015 The WebRTC project authors. All Rights Reserved.
 *
 *  Use of this source code is governed by a BSD-style license
 *  that can be found in the LICENSE file in the root of the source
 *  tree.
 */
/* global TimelineDataSeries, TimelineGraphView */

'use strict';
import {bc} from '/js/docXR.js';
import * as THREE from 'three';
class VoiceChat extends bc.control.Control {
  userMap = {};
  mute = true;
  username = "user#" + Math.floor(Math.random() * 999999);
  online = false;
  supportsSetCodecPreferences = window.RTCRtpTransceiver &&
    'setCodecPreferences' in window.RTCRtpTransceiver.prototype;
  codecPreferences = "opus";
  offerOptions = {
    offerToReceiveAudio: 1,
    offerToReceiveVideo: 0,
    voiceActivityDetection: false
  };
  status = 'Unknown';
	async init(inDesign) {
    bc.audio = this;
    this.localStream = await navigator.mediaDevices.getUserMedia({audio:true, video:false});
    this.addListener('addChannelUser', async (inUser)=>{
      const userId = inUser.userId;
      let callback = e => {this.server.direct(userId, 'ice', {candidate:e.candidate})};
      inUser.pc = await this.createPeerConnection(callback, inUser);
      const offer = await inUser.pc.createOffer();
      await inUser.pc.setLocalDescription(offer);
      inUser.sdp = offer;
      try {
        const response = await this.server.directRequest(userId, 'audio', {sdp:inUser.sdp});
        console.log('response:', response);
        inUser.sdp = response.sdp; // Hack - replace sdp for simplicity.
        await inUser.pc.setRemoteDescription(inUser.sdp);
      } catch (e) {console.error(e)}
    });
    this.server.addListener('audio', async (inMessage)=>{
      const fromUserId = inMessage.fromUserId;
      const fromUser = {userId:fromUserId, sdp:inMessage.sdp};
      this.userMap[fromUserId] = fromUser;
      let callback = e => {this.server.direct(fromUser.userId, 'ice', {candidate:e.candidate})};
      fromUser.pc = await this.createPeerConnection(callback, fromUser);
//console.log('handleOffer offer:', fromUser);
      await fromUser.pc.setRemoteDescription(inMessage.sdp);
      const answer = await fromUser.pc.createAnswer();
      await fromUser.pc.setLocalDescription(answer);
      fromUser.sdp = answer;  // Hack - Replace connection description.
//console.log('We Have answer Audio:', fromUser.sdp);
      this.server.directResponse(inMessage, {sdp:fromUser.sdp});
      this.status = 'addUser';
      const sch = this.statusChangeHandler;
      if (sch) {await sch.doBroadcastAction({'status':this.status}, {}, this) }
    });
    this.server.addListener('ice', (inMessage)=>{
console.log('ice message:', inMessage);
      const fromUser = this.userMap[inMessage.fromUserId];
//console.log('user:', this.server.userId, ' fromUserId:', fromUser, ' ice:', inMessage);
      if (inMessage.candidate) {fromUser.pc.addIceCandidate(inMessage.candidate);}
      else {fromUser.pc.addIceCandidate(null);}
    });
//    this.call();
  };
  async createPeerConnection(callback, inUser) {
/*    let pc = new RTCPeerConnection({
      iceServers: [
        {urls: "stun:openrelay.metered.ca:80"},
        {urls: "turn:openrelay.metered.ca:80", username: "openrelayproject", credential: "openrelayproject"},
        {urls: "turn:openrelay.metered.ca:443", username: "openrelayproject", credential: "openrelayproject"},
        {urls: "turn:openrelay.metered.ca:443?transport=tcp", username: "openrelayproject", credential: "openrelayproject"},
      ],
    }); */
    let pc = new RTCPeerConnection({iceServers: [{urls: "turn:braincavexr.com:3478", username: "demo", credential: "demo202"}]});
    pc.onconnectionstatechange = (ev) => {
      switch(pc.connectionState) {
        case "new":
        case "checking":
          console.log("Connecting…");
          break;
        case "connected":
          console.log("Online");
          break;
        case "disconnected":
          console.log("Disconnecting…");
          this.status = 'addUser';
          const sch = this.statusChangeHandler;
          if (sch) {sch.doBroadcastAction({'status':this.status}, {}, this) }
          break;
        case "closed":
          console.log("Offline");
          break;
        case "failed":
          console.log("Error");
          break;
        default:
          console.log("Unknown");
          break;
      }
    }

    pc.onicecandidate = callback;
    let audioHtml = inUser.audioHtml = document.createElement('audio');
    audioHtml.id = 'audioHtml'+inUser.userId;
    audioHtml.autoplay = true;
    pc.ontrack = e => {audioHtml.srcObject = e.streams[0]; console.warn(e)};
    this.localStream.getTracks().forEach(track => pc.addTrack(track, this.localStream));
    return pc;
  }
  // Receive a source of channels to insert the number of users for each channel in the source.
  async doSwitchChannelAction(inDesign, inChannelId) {
  console.log('Switched Channel to ', inChannelId);
    if (this.channelId) {
      let response = await this.server.serverRequest({type:'leaveAnchorRequest', message:{anchorId:this.channelId}});
      for (let key in this.userMap) {
        let user = this.userMap[key];
        user.pc.close();
console.log('closed user:', user);
      }
    }
    this.userMap = {};
    this.channelId = inChannelId;
    let response = await this.server.serverRequest({type:'joinAnchorRequest', message:{anchorId:this.channelId}});
    for (let uI in response.users) {
      let userId = response.users[uI];
console.log('user:', userId, ' in channel:', inChannelId);
      if (userId != this.server.userId) {
        let user = {userId:userId};
        this.userMap[userId] = user;
        await this.notifyListeners('addChannelUser', user);
      }
    }
  }
  async doChannelsStatusAction(inDesign, inSource) {
    const grid = inSource.grid;
    for (let rI = 0, rLen = grid.length; rI < rLen; rI++) {
      const record = grid[rI];
      const channelId = record.map['NAME'];
      let response = await this.server.serverRequest({type:'statusAnchorRequest', message:{anchorId:channelId}});
      record.map['USERS'] = response.userCount;
    }
  }
	static get definition() {return {name:'VoiceChat', type:bc.CLASS, childMap:{
		doTalk:{type:bc.BOOLEAN, mod:bc.ACTION},
    doChannelsStatus:{type:'Source', mod:bc.ACTION, description:'update a table of channels with number of users'},
    doSwitchChannel:{type:bc.STRING, mod:bc.ACTION, description:'Switch to a new voice channel'},
    statusChangeHandler:{type:'Handler', mod:bc.FIELD, description:'Notifies of channel status change'},
    mute:{type:bc.BOOLEAN, mod:bc.FIELD, default:true, description:'Mute microphone'},
		waitOnServer:{type:bc.CONTROL, mod:bc.FIELD}}}}
}
bc.ControlFactory.newFactory(VoiceChat);
export {VoiceChat}
