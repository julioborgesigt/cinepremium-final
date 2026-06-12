'use strict';

/**
 * O app usa o Chromium do sistema (/usr/bin/chromium-browser, ver ciabraService.js),
 * então o download do chrome-headless-shell pelo npm install é desnecessário
 * e quebra o deploy em hosts com cache corrompido (ex: DOM Cloud).
 */
module.exports = {
    skipDownload: true
};
