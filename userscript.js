// ==UserScript==
// @name         Apple Music RPC
// @namespace    https://github.com/darkceius/amrpc-userscript
// @supportURL   https://github.com/darkceius/amrpc-userscript
// @version      2026-02-27
// @description  Apple Music discord RPC
// @author       Darkceius (https://github.com/darkceius)
// @match        https://music.apple.com/*
// @match        https://beta.music.apple.com/*
// @icon         https://www.google.com/s2/favicons?sz=48&domain=music.apple.com
// @grant        unsafeWindow
// @grant        GM_xmlhttpRequest
// @connect      localhost
// ==/UserScript==

(function () {
	"use strict";

	if (window.self !== window.top) return;

	const ARTWORK_SIZE = 128;
	const PROXY_URL = "http://localhost:7635";
	const AM_LOGO = `https://www.google.com/s2/favicons?sz=64&domain=music.apple.com`;

	let lastPresenceState = undefined;
	let musicKit;

	const getMusicKit = () => {
		if (musicKit) return;

		musicKit = unsafeWindow.MusicKit?.getInstance();
	};

	const getPlayingMetadata = () => {
		getMusicKit();

		if (!musicKit || musicKit.playbackState !== 2) return null;

		const songPosition = musicKit.currentPlaybackTime;
		const songLength = musicKit.currentPlaybackDuration;

		const playingItem = musicKit.nowPlayingItem;
		if (!playingItem) return null;

		const attributes = playingItem.attributes;
		const playParams = attributes.playParams;

		return {
			position: isFinite(songPosition) && songPosition,
			length: isFinite(songLength) && songLength,

			id:
				playParams?.catalogId || (parseFloat(playParams?.id) && playParams?.id),
			name: attributes.name,
			artist: attributes.artistName,
			album: attributes.albumName,
			artwork: attributes.artwork?.url
				.replace("{w}", ARTWORK_SIZE)
				.replace("{h}", ARTWORK_SIZE),
		};
	};

	const clearPresence = () => {
		lastPresenceState = false;

		GM_xmlhttpRequest({
			method: "POST",
			url: `${PROXY_URL}/clear`,
		});
	};

	window.addEventListener("beforeunload", () => {
		clearPresence();
	});

	const updateRPC = () => {
		const playingMeta = getPlayingMetadata();

		if (!playingMeta) {
			if (lastPresenceState) {
				clearPresence();
			}

			return;
		}

		const startTime = Math.floor(Date.now() - playingMeta.position * 1000);
		const endTime = Math.floor(startTime + playingMeta.length * 1000);

		lastPresenceState = true;

		const data = {
			type: 2,
			details: playingMeta.name,
			state: playingMeta.artist,
			status_display_type: 1,
			assets: {
				large_image:
					!playingMeta.artwork || playingMeta.artwork.length >= 200
						? AM_LOGO
						: playingMeta.artwork,
			},
			timestamps: {
				start: startTime,
				end: endTime,
			},
			buttons: [],
		};

		if (playingMeta.id) {
			data.buttons.push({
				label: "Listen Along",
				url: `https://song.link/i/${playingMeta.id}`,
			});
		}

		GM_xmlhttpRequest({
			method: "POST",
			url: `${PROXY_URL}/set`,
			headers: {
				"Content-Type": "application/json",
			},
			data: JSON.stringify(data),
		});
	};

	setInterval(() => {
		updateRPC();
	}, 1000 * 5);
})();
