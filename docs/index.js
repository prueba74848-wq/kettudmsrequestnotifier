(function (exports) {
  "use strict";

  const { findByStoreName } = vendetta.metro;
  const { FluxDispatcher, React, ReactNative } = vendetta.metro.common;
  const { showToast } = vendetta.ui.toasts;
  const { getAssetIDByName } = vendetta.ui.assets;
  const { storage } = vendetta.plugin;
  const { useProxy } = vendetta.storage;
  const { Forms } = vendetta.ui.components;

  // Defaults
  storage.notifySpam ??= true;
  storage.notifyEveryMessage ??= false;

  // Channels already notified this session (one alert per request)
  const notified = new Set();

  const getStore = (name) => {
    try { return findByStoreName(name); } catch (e) { return null; }
  };

  const isMessageRequest = (channelId) => {
    try { return !!getStore("MessageRequestStore")?.isMessageRequest?.(channelId); } catch (e) { return false; }
  };

  const isSpamRequest = (channelId) => {
    try { return !!getStore("MessageRequestStore")?.isSpam?.(channelId); } catch (e) { return false; }
  };

  // Persisted list of request channels already known, so old ones stay silent
  const getPendingIds = () => {
    try {
      const store = getStore("MessageRequestStore");
      const ids = store?.getMessageRequestChannelIds?.();
      if (!ids) return null;
      return Array.from(ids);
    } catch (e) { return null; }
  };

  function checkPendingOnStart() {
    try {
      const pending = getPendingIds();
      if (!pending) return;
      // First run: just remember what's already there, notify nothing
      if (!Array.isArray(storage.knownRequests)) {
        storage.knownRequests = pending;
        return;
      }
      const known = new Set(storage.knownRequests);
      const fresh = pending.filter((id) => !known.has(id));
      // Keep only requests that are still pending, plus the new ones
      storage.knownRequests = pending;
      fresh.forEach((id) => notified.add(id));
      if (!fresh.length) return;
      const spamCount = fresh.filter(isSpamRequest).length;
      const count = storage.notifySpam ? fresh.length : fresh.length - spamCount;
      if (count <= 0) return;
      showToast(
        `You have ${count} new DM request${count > 1 ? "s" : ""} since last time`,
        getAssetIDByName("ic_message_retry") ?? getAssetIDByName("ic_chat_bubble_16px")
      );
    } catch (e) {
      console.error("[DMRequestNotifier]", e);
    }
  }

  function notify(channelId, name) {
    const spam = isSpamRequest(channelId);
    if (spam && !storage.notifySpam) return;
    if (!storage.notifyEveryMessage && notified.has(channelId)) return;
    notified.add(channelId);
    if (Array.isArray(storage.knownRequests) && !storage.knownRequests.includes(channelId)) {
      storage.knownRequests.push(channelId);
    }
    showToast(
      `${spam ? "New spam DM request" : "New DM request"} from ${name}`,
      getAssetIDByName("ic_message_retry") ?? getAssetIDByName("ic_chat_bubble_16px")
    );
  }

  function onMessageCreate({ message, optimistic, channelId }) {
    try {
      if (!message || optimistic) return;
      const me = getStore("UserStore")?.getCurrentUser?.();
      if (!message.author || message.author.id === me?.id) return;

      const cid = channelId ?? message.channel_id;
      const channel = getStore("ChannelStore")?.getChannel?.(cid);
      if (!channel || channel.type !== 1) return; // 1 = DM
      if (!isMessageRequest(cid)) return;

      const name = message.author.global_name ?? message.author.globalName ?? message.author.username ?? "someone";
      notify(cid, name);
    } catch (e) {
      console.error("[DMRequestNotifier]", e);
    }
  }

  function onChannelCreate({ channel }) {
    // The store may update just after the event, so check a moment later
    setTimeout(() => {
      try {
        if (!channel || channel.type !== 1 || !isMessageRequest(channel.id)) return;
        const userId = channel.recipients?.[0];
        const user = getStore("UserStore")?.getUser?.(userId);
        notify(channel.id, user?.globalName ?? user?.username ?? "someone");
      } catch (e) {
        console.error("[DMRequestNotifier]", e);
      }
    }, 500);
  }

  function onConnectionOpen() {
    setTimeout(checkPendingOnStart, 3000);
  }

  function Settings() {
    useProxy(storage);
    const { ScrollView } = ReactNative;
    const { FormSection, FormSwitchRow, FormText } = Forms;
    return React.createElement(
      ScrollView,
      null,
      React.createElement(
        FormSection,
        { title: "DM Request Notifier" },
        React.createElement(FormSwitchRow, {
          label: "Notify for spam requests",
          subLabel: "Also alert for requests Discord marked as possible spam",
          value: storage.notifySpam,
          onValueChange: (v) => (storage.notifySpam = v),
        }),
        React.createElement(FormSwitchRow, {
          label: "Notify on every message",
          subLabel: "Alert on each new message from a pending request, not just the first",
          value: storage.notifyEveryMessage,
          onValueChange: (v) => (storage.notifyEveryMessage = v),
        })
      )
    );
  }

  exports.default = {
    onLoad() {
      FluxDispatcher.subscribe("MESSAGE_CREATE", onMessageCreate);
      FluxDispatcher.subscribe("CHANNEL_CREATE", onChannelCreate);
      FluxDispatcher.subscribe("CONNECTION_OPEN", onConnectionOpen);
      setTimeout(checkPendingOnStart, 3000);
    },
    onUnload() {
      FluxDispatcher.unsubscribe("MESSAGE_CREATE", onMessageCreate);
      FluxDispatcher.unsubscribe("CHANNEL_CREATE", onChannelCreate);
      FluxDispatcher.unsubscribe("CONNECTION_OPEN", onConnectionOpen);
      notified.clear();
    },
    settings: Settings,
  };

  return exports;
})({});
