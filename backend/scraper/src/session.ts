import type { ScraperOptions } from './types.js';

export class LibrarySession {
  private readonly baseUrl: string;
  private readonly cardNo: string;
  private readonly password: string;
  private readonly cookies = new Map<string, string>();
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
    const sid = this.cookies.get('SID');
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

    await this.discard(await this.rawRequest('/OPWUSERLOGIN.CSP'));
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
    headers.set(
      'Cookie',
      Array.from(this.cookies, ([key, value]) => `${key}=${value}`).join('; '),
    );

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
        const [pair] = setCookie.split(';');
        const separator = pair.indexOf('=');
        if (separator <= 0) {
          continue;
        }

        const key = pair.slice(0, separator).trim();
        const value = pair.slice(separator + 1).trim();
        if (key && value) {
          this.cookies.set(key, value);
        }
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
