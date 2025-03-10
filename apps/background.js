let resetEncoding = [
    ['default', '默认/重置']
];
// 某Tab的编码都暂存一下，这是prefix
const ENCODING_PREFIX = 'FE_ENCODING_PREFIX_';

let Storage = {
    getItem: async function (key) {
        let object = await chrome.storage.local.get([key]) ?? [];
        return object?.[key];
    },
    removeItem: async function (key) {
        await chrome.storage.local.remove([key])
    },
    setItem: async function (key, value) {
        await chrome.storage.local.set({[key]: value})
    }
}

let PageEncoding = (() => {

    let listenerAddedFlag = false;
    let contextMenuId = null;

    // 系统支持的编码列表
    let SystemCharsetList = [
        ['UTF-8', 'Unicode（UTF-8）'],
        ['GBK', '简体中文（GBK）'],
        ['GB3212', '简体中文（GB3212）'],
        ['GB18030', '简体中文（GB18030）'],
        ['Big5', '繁体中文（Big5）'],
        ['UTF-16LE', 'Unicode（UTF-16LE）'],
        ['EUC-KR', '韩文（EUC-KR）'],
        ['Shift_JIS', '日文（Shift_JIS）'],
        ['EUC-JP', '日文（EUC-JP）'],
        ['ISO-2022-JP', '日文（ISO-2022-JP）'],
        ['Windows-874', '泰文（Windows-874）'],
        ['Windows-1254', '土耳其文（Windows-1254）'],
        ['ISO-8859-7', '希腊文（ISO-8859-7）'],
        ['Windows-1253', '希腊文（Windows-1253）'],
        ['Windows-1252', '西文（Windows-1252）'],
        ['ISO-8859-15', '西文（ISO-8859-15）'],
        ['Macintosh', '西文（Macintosh）'],
        ['Windows-1258', '越南文（Windows-1258）'],
        ['ISO-8859-2', '中欧文（ISO-8859-2）'],
        ['Windows-1250', '中欧文（Windows-1250）']
    ];


    // 菜单列表
    let menuMap = {};


    /**
     * 创建右键菜单
     */
    let createMenu = async () => {

        contextMenuId = chrome.contextMenus.create({
            id: "addone-charset",
            title: "Charset",
            contexts: ['all'],
            documentUrlPatterns: ['http://*/*', 'https://*/*', 'file://*/*']
        });

        chrome.contextMenus.create({
            id: "addone-charset.all",
            contexts: ["all"],
            title: '检测当前网页字符集',
            parentId: contextMenuId,
        });
        chrome.contextMenus.create({
            id: "addone-charset.separator",
            type: 'separator',
            parentId: contextMenuId
        });

        // 如果已经在设置页重新设置过字符集，这里则做一个覆盖，负责还原为默认
        let encodingList = Array.from(SystemCharsetList);
        let chartsetCustoms = await Storage.getItem('fh-charset-customs') || '[]';
        let customEncodings = JSON.parse(chartsetCustoms);
        if (customEncodings && customEncodings.length) {
            encodingList = customEncodings;
        } else {
            await Storage.setItem('fh-charset-customs', JSON.stringify(SystemCharsetList));
        }

        resetEncoding.concat(encodingList).forEach((item, idx) => {
            menuMap[item[0].toUpperCase()] = chrome.contextMenus.create({
                id: `addone-charset.menu.${item[0]}`,
                type: "radio",
                contexts: ["all"],
                title: item[0] === resetEncoding[0][0] ? resetEncoding[0][1] : `${item[1]}`,
                checked: false,
                parentId: contextMenuId,
            });
        });

    };

    /**
     * 更新菜单的选中状态
     * @param tabId
     */
    let updateMenu = async (tabId) => {

        // 选中它该选中的
        let encoding = await Storage.getItem(ENCODING_PREFIX + tabId) || '';
        let menuId = menuMap[encoding.toUpperCase()];

        Object.keys(menuMap).forEach(menu => {
            chrome.contextMenus.update(menuMap[menu], {
                checked: menuMap[menu] === menuId
            });
        });

    };

    const ruleId = 123432;
    /**
     * web请求截获，重置response Headers
     */
    let addOnlineSiteEncodingListener = async (contentType, tabId, callback) => {
        listenerAddedFlag = true;
        let tabEncoding = await Storage.getItem(ENCODING_PREFIX + tabId);
        let resourceTypes = [
            "main_frame", "sub_frame",
            // 'csp_report', 'font', 'image', 'media', 'object', 'other', 'ping', 'script',
            // 'stylesheet', 'webbundle', 'websocket', 'webtransport', 'xmlhttprequest'
        ];
        contentType = (!contentType || !`${contentType}`.trim().length) ? 'text/plain' : contentType;
        console.log('change', {contentType, tabEncoding, tabId})

        if (tabEncoding) {
            const rules = {
                removeRuleIds: [ruleId],
                addRules: [
                    {
                        id: ruleId,
                        priority: 1,
                        condition: {
                            tabIds: [tabId],
                            urlFilter: "*",
                            resourceTypes: resourceTypes
                        },
                        action: {
                            type: "modifyHeaders",
                            responseHeaders: [{
                                header: "Content-Type",
                                operation: "set",
                                value: `${contentType}; charset=${tabEncoding}`
                            }],
                        }
                    }
                ],
            };
            chrome.declarativeNetRequest.updateSessionRules(rules, () => {
                if (chrome.runtime.lastError) {
                    console.error(chrome.runtime.lastError);
                } else {
                    chrome.declarativeNetRequest.getSessionRules(rules => console.log('rules', {rules}));
                }
            });
        } else {
            await chrome.declarativeNetRequest.updateSessionRules({
                removeRuleIds: [ruleId],
            });
        }

        // 标签被关闭时的检测
        chrome.tabs.onRemoved.addListener((tabId, removeInfo) => {
            Storage.removeItem(ENCODING_PREFIX + tabId);
        });
        // 标签页有切换时
        chrome.tabs.onActivated.addListener((activeInfo) => {
            if (Object.keys(menuMap).length) {
                updateMenu(activeInfo.tabId);
            }
        });

        callback && callback();
    };

    chrome.runtime.onMessage.addListener(function (request, sender, callback) {
        // 如果发生了错误，就啥都别干了
        if (chrome.runtime.lastError) {
            console.log('Error', chrome.runtime.lastError);
            return true;
        }

        if (request.type === 'fh-charset-update-menu') {
            if (!contextMenuId) return;
            chrome.contextMenus.removeAll(async () => {
                menuMap = {};
                await createMenu();
            });
        }

        callback && callback();
        return true;
    });

    return {
        addOnlineSiteEncodingListener,
        createMenu
    };

})();

chrome.runtime.onInstalled.addListener(async () => {
    await PageEncoding.createMenu();
});
chrome.contextMenus.onClicked.addListener(async function (info, tab) {
    let menuItemId = info?.menuItemId;
    if (menuItemId === "addone-charset.all") {
        await chrome.scripting.executeScript({
            target: {tabId: tab.id},
            func: (items) => {
                alert(`当前网页字符集是：${document.charset}`)
            },
            args: [] // pass any parameters to function
        });
        return;
    }

    let result = await chrome.scripting.executeScript({
        target: {tabId: tab.id},
        func: () => {
            return document.contentType
        },
        injectImmediately: false,
        world: 'MAIN',
        args: [] // pass any parameters to function
    })
    let contentType = result?.[0]?.result;

    let targetEncoding = (() => {
        let menus = menuItemId.split('.');
        return menus[menus.length - 1]
    })();

    if (!info.wasChecked || targetEncoding === resetEncoding[0][0]) {
        if (targetEncoding === resetEncoding[0][0]) {
            await Storage.removeItem(ENCODING_PREFIX + tab.id);
        } else {
            await Storage.setItem(ENCODING_PREFIX + tab.id, targetEncoding);
        }
        await PageEncoding.addOnlineSiteEncodingListener(contentType, tab.id, () => {
            chrome.tabs.reload(tab.id, {
                bypassCache: true
            });
        });
    }
});