import {
  extractToken,
  extractTokens,
  parseNewBooks,
  parseUserStatus,
} from './parsers.js';
import { LibrarySession } from './session.js';
import type { LibraryScraper, ScraperOptions } from './types.js';

export class Scraper implements LibraryScraper {
  private readonly session: LibrarySession;
  private readonly cardNo: string;

  constructor(options: ScraperOptions) {
    this.session = new LibrarySession(options);
    this.cardNo = options.cardNo;
  }

  async getUserStatus() {
    return parseUserStatus(await this.session.getHtml('/OPWUSERINFO.CSP'));
  }

  async getNewBooks() {
    return parseNewBooks(
      await this.session.getHtml('/OPWNEWBOOK.CSP?WRTCOUNT=100'),
    );
  }

  async extendLoan(barcode: string): Promise<Response> {
    const html = await this.session.getHtml('/OPWUSERINFO.CSP', {
      updateCookies: false,
    });
    const token = extractToken(html, 0);
    const sid = await this.session.getSid();

    return this.session.post(
      '/%25CSP.Broker.cls',
      {
        WARGC: '8',
        WEVENT: token,
        WARG_1: sid,
        WARG_2: 'OPWUSERINFO',
        WARG_3: 'LIB',
        WARG_4: '1',
        WARG_5: barcode,
        WARG_6: 'chkLKOUSIN',
        WARG_7: '',
        WARG_8: '',
      },
      { updateCookies: false },
    );
  }

  async reserveBook(bookNo: string): Promise<Response> {
    const newBookHtml = await this.session.getHtml(
      '/OPWNEWBOOK.CSP?WRTCOUNT=100',
    );
    const eventTokens = extractTokens(newBookHtml);
    const sid = await this.session.getSid();

    if (eventTokens.length < 2) {
      throw new Error(
        'Could not find both reservation event tokens on the new-books page.',
      );
    }

    await this.session.discard(
      await this.session.post('/%25CSP.Broker.cls', {
        WARGC: '5',
        WEVENT: eventTokens[0],
        WARG_1: sid,
        WARG_2: bookNo,
        WARG_3: 'OPWNEWBOOK',
        WARG_4: '',
        WARG_5: '',
      }),
    );

    await this.session.discard(
      await this.session.post('/%25CSP.Broker.cls', {
        WARGC: '7',
        WEVENT: eventTokens[1],
        WARG_1: sid,
        WARG_2: '',
        WARG_3: 'OPWNEWBOOK',
        WARG_4: '',
        WARG_5: '',
        WARG_6: '',
        WARG_7: '',
      }),
    );

    await this.session.discard(await this.session.get('/OPWBOOK.CSP'));

    const reservationFields = {
      SID: sid,
      FLG: 'CHK',
      BID: bookNo,
      MBID: bookNo,
      DB: 'LIB',
      MODE: '1',
      SRCID: '',
      PID: 'OPWBOOK',
      PID2: '',
      GBID: '',
      LIB: '',
      PREPID: 'OPWBOOK',
      NEXTPID: 'OPWBOOK',
      library: '30',
      call: '3',
      reg: '　登録する　',
    };

    await this.session.discard(
      await this.session.post('/OPWLOGINTIME.CSP', reservationFields),
    );
    await this.session.discard(
      await this.session.post('/OPWBOOK.CSP', {
        ...reservationFields,
        MAINFLG: '',
      }),
    );

    const confirmationFields = {
      SID: sid,
      FLG: 'SET',
      BID: bookNo,
      MBID: bookNo,
      DB: 'LIB',
      MODE: '1',
      SRCID: '',
      PID: 'OPWBOOK',
      PID2: '',
      GBID: '',
      LIB: '',
      PREPID: 'OPWBOOK',
      NEXTPID: 'OPWBOOK',
      library: '30',
      call: '3',
      contact2: '',
      chkR: '1',
      limitdate: '',
      usercardid: this.cardNo ?? '',
      biko: '',
    };

    await this.session.discard(
      await this.session.post('/OPWLOGINTIME.CSP', confirmationFields),
    );
    return this.session.post('/OPWBOOK.CSP', {
      ...confirmationFields,
      PID2: 'OPWNEWBOOK',
      MAINFLG: '',
    });
  }
}

export function createScraper(options: ScraperOptions): LibraryScraper {
  return new Scraper(options);
}
