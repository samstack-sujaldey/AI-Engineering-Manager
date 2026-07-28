const { newId } = require("../utils/helpers");

class ConnectService {
  constructor() {
    this.requests = new Map();
    this.relatedWorkRequests = new Map();
  }

  createRequest({
    senderId,
    senderName,
    targetUserId,
    targetUserName,
    channel,
    threadTs,
  }) {
    const request = {
      id: newId("conn"),
      senderId,
      senderName: senderName || senderId,
      targetUserId,
      targetUserName: targetUserName || targetUserId,
      channel,
      threadTs,
      dmChannel: null,
      status: "PENDING",
      createdAt: new Date(),
      scheduledAt: null,
    };
    this.requests.set(targetUserId, request);
    return request;
  }

  setDmChannel(targetUserId, dmChannel) {
    const req = this.requests.get(targetUserId);
    if (req) req.dmChannel = dmChannel;
  }

  getByTarget(targetUserId) {
    return this.requests.get(targetUserId) || null;
  }

  updateStatus(targetUserId, status, scheduledAt = null) {
    const req = this.requests.get(targetUserId);
    if (!req) return null;
    req.status = status;
    req.scheduledAt = scheduledAt;
    return req;
  }

  remove(targetUserId) {
    this.requests.delete(targetUserId);
  }

  createRelatedWorkRequest(threadTs, data) {
    const request = {
      threadTs,
      relatedUsers: data.relatedUsers || [],
      workItems: data.workItems || [],
      channel: data.channel || "",
      createdAt: new Date(),
    };
    this.relatedWorkRequests.set(threadTs, request);
    return request;
  }

  getRelatedWorkRequest(threadTs) {
    return this.relatedWorkRequests.get(threadTs) || null;
  }

  removeRelatedWorkRequest(threadTs) {
    this.relatedWorkRequests.delete(threadTs);
  }
}

module.exports = { ConnectService };
