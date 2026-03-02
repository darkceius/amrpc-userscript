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
// @connect      rise.cider.sh
// ==/UserScript==
/// <reference types="./types" />

(function () {
	"use strict";

	if (window.self !== window.top) return;

	const ARTWORK_SIZE = 128;
	const PROXY_URL = "http://localhost:7635";
	const AM_LOGO = `https://www.google.com/s2/favicons?sz=64&domain=music.apple.com`;
	const REQUEST_HEADERS = { Origin: "amrpc-userscript" };

	const SETTINGS = {
		USE_CIDER_ARTWORK_SERVICE: true,
	};

	let lastPresenceState = undefined;
	let musicKit;

	let playingSongId;
	let animatedArtworkURL;

	let albumIdCache = {};
	let artworkCache = {};

	const getMusicKit = () => {
		if (musicKit) return;

		//@ts-ignore
		musicKit = unsafeWindow.MusicKit?.getInstance();
	};

	const getAlbumData = async (songId) => {
		const cacheHit = albumIdCache[songId];
		if (cacheHit) return cacheHit;

		getMusicKit();

		const response = await musicKit.api.music(
			`v1/catalog/${musicKit.storefrontId || "us"}/songs/${songId}`,
			{
				include: "albums",
				"fields[albums]": "id,editorialVideo",
				"fields[songs]": "id",
			},
		);

		if (response.errors) return null;

		const albumData = response.data.data[0].relationships.albums.data[0];
		const albumId = albumData.id;

		let m3u8Stream;
		/** @type {Object.<string, { previewFrame: Object, video: string }>} */
		const editorialVideo = albumData.attributes?.editorialVideo;

		if (editorialVideo) {
			for (const [_, value] of Object.entries(editorialVideo)) {
				if (value.video) {
					m3u8Stream = value.video;
					break;
				}
			}
		}

		albumIdCache[songId] = {
			albumId: albumId,
			videoStream: m3u8Stream,
		};

		return albumIdCache[songId];
	};

	const getAnimatedArtworkURL = async (albumId, videoStream = null) => {
		const cacheHit = artworkCache[albumId];
		if (cacheHit) return cacheHit;
		if (!videoStream) return null;

		let outputURL;

		// ❤️ to cider.sh devs letting people use it
		// https://discord.com/channels/843954443845238864/997036669976989777/1478104510328209578
		if (SETTINGS.USE_CIDER_ARTWORK_SERVICE) {
			outputURL = await new Promise((resolve) => {
				GM_xmlhttpRequest({
					method: "GET",
					url: `https://rise.cider.sh/api/v1/artwork/generate?url=${encodeURIComponent(videoStream)}`,
					headers: { Accept: "application/json" },
					onload: (response) => {
						try {
							resolve(JSON.parse(response.responseText)?.url || null);
						} catch {
							resolve(null);
						}
					},
					onerror: () => resolve(null),
				});
			});
		}

		artworkCache[albumId] = outputURL;
		return artworkCache[albumId];
	};

	const updateAnimatedArtwork = async () => {
		if (animatedArtworkURL) return;

		const currentId = playingSongId;

		const { albumId, videoStream } = await getAlbumData(currentId);
		if (playingSongId !== currentId || !videoStream) return;

		const artworkURL = await getAnimatedArtworkURL(albumId, videoStream);
		if (playingSongId !== currentId || !artworkURL) return;

		animatedArtworkURL = artworkURL;
		updateRPC(false);
	};

	const getPlayingMetadata = (intervalChecked = false) => {
		getMusicKit();

		if (!musicKit || musicKit.playbackState !== 2) return null;

		const songPosition = musicKit.currentPlaybackTime;
		const songLength = musicKit.currentPlaybackDuration;

		const playingItem = musicKit.nowPlayingItem;
		if (!playingItem) return null;

		const attributes = playingItem.attributes;
		const playParams = attributes.playParams;

		const songId = playParams?.id;
		const catalogId = playParams?.catalogId || (parseFloat(songId) && songId);

		if (intervalChecked && catalogId !== playingSongId) {
			playingSongId = catalogId;
			animatedArtworkURL = null;
		}

		return {
			position: songPosition,
			length: songLength,

			id: catalogId,
			name: attributes.name,
			artist: attributes.artistName,
			album: attributes.albumName,
			artwork:
				animatedArtworkURL ||
				attributes.artwork?.url
					.replace("{w}", ARTWORK_SIZE)
					.replace("{h}", ARTWORK_SIZE),
		};
	};

	const clearActivity = () => {
		lastPresenceState = false;

		GM_xmlhttpRequest({
			method: "POST",
			headers: REQUEST_HEADERS,
			url: `${PROXY_URL}/clear`,
		});
	};

	const updateActivity = (data) => {
		GM_xmlhttpRequest({
			method: "POST",
			url: `${PROXY_URL}/set`,
			headers: {
				"Content-Type": "application/json",
				...REQUEST_HEADERS,
			},
			data: JSON.stringify(data),
		});
	};

	window.addEventListener("beforeunload", () => {
		clearActivity();
	});

	const updateRPC = (intervalChecked = true) => {
		const playingMeta = getPlayingMetadata(intervalChecked);

		if (!playingMeta) {
			if (lastPresenceState) clearActivity();
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

		updateActivity(data);
		if (intervalChecked) updateAnimatedArtwork();
	};

	setInterval(() => {
		updateRPC();
	}, 1000 * 5);

	setInterval(
		() => {
			albumIdCache = {};
			artworkCache = {};
		},
		1000 * 60 * 15,
	);
})();
