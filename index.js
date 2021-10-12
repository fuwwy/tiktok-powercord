const { Plugin } = require('powercord/entities');
const { getModule, getModuleByDisplayName, messages, channels: { getChannelId }, constants: { Endpoints } } = require('powercord/webpack');
const { get } = require('powercord/http');

module.exports = class TiktokEmbed extends Plugin {
    videoRegex = /(https:\/\/[^.]*.tiktok.com\/(?:@[^\/]*\/video\/\d*|[^\/]*\/))/;

    async startPlugin() {
        this.registerCmds()
    }

    pluginWillUnload() {
        powercord.api.commands.unregisterCommand('tikdown');
    }

    async createMessage(text) {
        const messages = await getModule([ 'sendMessage', 'editMessage' ]);
        const { createBotMessage } = await getModule([ 'createBotMessage' ]);
        const receivedMessage = createBotMessage(getChannelId(), '');
        receivedMessage.author.username = 'Tiktok Downloader';
        receivedMessage.author.avatar = 'powercord';
        receivedMessage.content = text;
        await messages.receiveMessage(receivedMessage.channel_id, receivedMessage);
        receivedMessage.update = async (text) => {
            receivedMessage.content = text;
            await messages.receiveMessage(receivedMessage.channel_id, receivedMessage);
            return receivedMessage;
        }
        receivedMessage.delete = () => {
            return messages.dismissAutomatedMessage(receivedMessage);
        }
        return receivedMessage;
    }

    async request(url, redirs = 0) {
        const rand = () => Math.floor(Math.random() * 1000000000) + 1;
        let result = await get(url)
                .set('DNT', '1')
                .set('User-Agent', 'Mozilla/5.0 (Linux; Android 6.0.1; Moto G (4)) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/92.0.4515.131 Mobile Safari/537.36 Edg/92.0.902.73')
                .set('Cookies', `tt_webid=${rand()}${rand()};tt_webid-v2=${rand()}${rand()}`)
                .set('Referer', 'https://wwww.tiktok.com/')
                .set('Range', 'bytes=0-');
        if ((result.statusCode === 301 || result.statusCode === 302) && redirs < 3) return this.request(result.headers.location, redirs++);
        return result;
    }

    getVideoInfo(result) {
        const videoInfo = {};
        videoInfo.id = result.match(/"id":"([^"]*)"/)[1];
        if (result.includes('playAddr')) {
            videoInfo.url = result.match(/"playAddr":"([^"]*)"/)[1];
            videoInfo.desc = result.match(/"desc":"([^"]*)"/)?.[1];
            const authorData = result.match(/"author":{([^}]*)}/)[1];
            videoInfo.posterName = authorData.match(/"nickname":"([^"]*)"/)?.[1];
            videoInfo.posterId = authorData.match(/"id":"([^"]*)"/)?.[1];
        } else { // Mobile
            const relevantData = result.split('itemInfos')[1]
            videoInfo.url = relevantData.match(/"video":{"urls":\["([^"]*)"\]/)[1];
            videoInfo.desc = relevantData.match(/"text":"([^"]*)"/)?.[1];
            videoInfo.posterName = relevantData.match(/"nickName":"([^"]*)"/)?.[1];
            videoInfo.posterId = relevantData.match(/"userId":"([^"]*)"/)?.[1];
            if (result.includes('shareUser')) {
                const shareData = relevantData.match(/"shareUser":{([^}]*)}/)[1];
                videoInfo.sharerName = shareData.match(/"nickName":"([^"]*)"/)?.[1];
                videoInfo.sharerId = shareData.match(/"userId":"([^"]*)"/)?.[1];
            }
        }
        videoInfo.medium = result.match(/utm_medium=([^&]*)&/)?.[1];
        videoInfo.source = result.match(/utm_source=([^&]*)&/)?.[1];
        videoInfo.url = decodeURIComponent(JSON.parse(`"${videoInfo.url}"`));
        return videoInfo;
    }

    async uploadFile(video, videoInfo, progressCallback) {
        const { default: createMessage } = await getModule([ 'createBotMessage' ]);
        this.createRequest = await getModule(
			m => typeof m === "function" && m.post
		);
        this.UploadErrorModal = await getModuleByDisplayName("UploadError");
        const request = this.createRequest.post(Endpoints.MESSAGES(getChannelId()));
		const formData = request._getFormData();
		formData.set("payload_json", JSON.stringify(createMessage(getChannelId())));
        const videoFile = new File(
            [video.buffer],
            `${videoInfo.posterId} - ${videoInfo.id}.mp4`,
            { type: 'video/mp4' }
        );
        formData.set("file0", videoFile);
        request.on("error", _ => {
			progressCallback(-1);
		});
        request.on("abort", _ => {
			progressCallback(100);
		});
        request.on("progress", _ => {
			progressCallback(_.percent);
		});
		request.on("complete", () => {
			progressCallback(100);
		});
        progressCallback(0);
        request.end();
    }

    registerCmds() {
        powercord.api.commands.registerCommand({
            command: 'tikdown',
            description: 'Download a tiktok video.',
            usage: '{url}',
            executor: async (args) => {
                if (!args[0]) return { result: 'You need to specify a url.' }
                if (!args[0].match(this.videoRegex)) return { result: 'Invalid video url.' }
                const message = await this.createMessage(`Fetching ${args[0]}...`);
                const result = (await this.request(args[0])).body.toString()
                const videoInfo = this.getVideoInfo(result);
                message.update(`Downloading ${args[0]}...`);
                const video = await this.request(videoInfo.url);
                message.update(`Uploading ${args[0]}...`);
                this.uploadFile(video.raw, videoInfo, (percent) => {
                    if (percent) message.update(`Uploading ${args[0]}... [${percent}/100]`);
                    if (percent === 100) setTimeout(() => message.delete(), 1000);
                });
                return;
            },
          });
    }
}