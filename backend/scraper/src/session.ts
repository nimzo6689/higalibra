import { CookieJar } from 'tough-cookie';
import type { ScraperOptions } from './types.js';

export class LibrarySession {
  private readonly baseUrl: string;
  private readonly cardNo: string;
  private readonly password: string;
  private readonly jar = new CookieJar();
  private authentication?: Promise<void>;

  constructor(options: ScraperOptions) {
    this.baseUrl = options.baseUrl.replace(/\/+$/, '');
    this.cardNo = options.cardNo;
    this.password = options.password;
  }

  async getHtml(
    path: string,
    options: { updateCookies?: boolean } = {},
  ): Promise<Buffer> {
    return Buffer.from(
      await (
        await this.request(path, {}, { updateCookies: options.updateCookies })
      ).arrayBuffer(),
    );
  }

  async getSid(): Promise<string> {
    await this.ensureAuthenticated();
    const cookies = await this.jar.getCookies(
      `${this.baseUrl}/OPWUSERLOGIN.CSP`,
    );
    const sid = cookies.find((cookie) => cookie.key === 'SID')?.value;
    if (!sid) {
      throw new Error(
        'The library login response did not include a SID cookie.',
      );
    }
    return sid;
  }

  async get(path: string): Promise<Response> {
    return this.request(path);
  }

  async post(
    path: string,
    fields: Record<string, string>,
    options: { dumpRequest?: boolean; updateCookies?: boolean } = {},
  ): Promise<Response> {
    return this.request(
      path,
      {
        method: 'POST',
        body: new URLSearchParams(fields),
      },
      options,
    );
  }

  async discard(response: Response): Promise<void> {
    await response.body?.cancel();
  }

  private ensureAuthenticated(): Promise<void> {
    this.authentication ??= this.login();
    return this.authentication;
  }

  private async login(): Promise<void> {
    if (!this.cardNo || !this.password) {
      throw new Error(
        'Both cardNo and password are required to use the scraper.',
      );
    }

    await this.discard(await this.rawRequest('/OPWUSERCONF.CSP'));
    const loginBody = new URLSearchParams({
      usercardno: this.cardNo,
      userpasswd: this.password,
    });

    await this.discard(
      await this.rawRequest(
        '/OPWUSERLOGIN.CSP',
        {
          method: 'POST',
          body: loginBody,
        },
        { updateCookies: false },
      ),
    );
    await this.discard(
      await this.rawRequest('/OPWUSERLOGIN.CSP', {
        method: 'POST',
        body: loginBody,
      }),
    );
  }

  private async request(
    path: string,
    init: RequestInit = {},
    options: { dumpRequest?: boolean; updateCookies?: boolean } = {},
  ): Promise<Response> {
    await this.ensureAuthenticated();
    return this.rawRequest(path, init, options);
  }

  private async rawRequest(
    path: string,
    init: RequestInit = {},
    options: { dumpRequest?: boolean; updateCookies?: boolean } = {},
  ): Promise<Response> {
    const url = new URL(path.replace(/^\/+/, ''), `${this.baseUrl}/`);
    const headers = new Headers(init.headers);
    const cookie = await this.jar.getCookieString(url.href);
    if (cookie) {
      headers.set('Cookie', cookie);
    }

    if (options.dumpRequest) {
      const dumpHeaders = new Headers(headers);
      if (
        init.body instanceof URLSearchParams &&
        !dumpHeaders.has('Content-Type')
      ) {
        dumpHeaders.set(
          'Content-Type',
          'application/x-www-form-urlencoded;charset=UTF-8',
        );
      }

      console.info('Library HTTP request dump:', {
        method: init.method ?? 'GET',
        url: url.href,
        headers: Object.fromEntries(dumpHeaders.entries()),
        body:
          init.body instanceof URLSearchParams
            ? init.body.toString()
            : init.body,
      });
    }

    const response = await fetch(url, { ...init, headers, redirect: 'manual' });
    if (options.updateCookies !== false) {
      for (const setCookie of response.headers.getSetCookie()) {
        await this.jar.setCookie(setCookie, url.href);
      }
    }

    if (response.status >= 400) {
      throw new Error(
        `Library request failed (${response.status} ${response.statusText}): ${url.href}`,
      );
    }

    return response;
  }
}
