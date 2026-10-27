import assert from 'node:assert/strict';
import test from 'node:test';
import { runKeeper } from '../src/keeper.ts';

const today = Temporal.PlainDate.from('2026-10-27');
const user = {
  name: '利用者',
  cardNo: 'card',
  password: 'password',
};
const secret = {
  baseUrl: 'https://library.example/OPW',
  users: [user],
  vapid: {
    subject: 'mailto:admin@example.com',
    publicKey: 'public',
    privateKey: 'private',
  },
};

function borrowedBook({
  barcode,
  status = '更新できません',
  returnOn = '2026-10-28',
  title = barcode,
}) {
  return {
    barcode,
    status,
    title,
    genre: '一般',
    borrowedOn: Temporal.PlainDate.from('2026-10-01'),
    returnOn: Temporal.PlainDate.from(returnOn),
  };
}

function reservedBook({ title, reservedOn, expireOn }) {
  return {
    userRank: 1,
    totalReservations: 2,
    title,
    reservedOn: Temporal.PlainDate.from(reservedOn),
    expireOn: expireOn ? Temporal.PlainDate.from(expireOn) : null,
  };
}

function dependencies({ previous = null, status, afterExtension, send }) {
  const saved = [];
  const notices = [];
  let statusReads = 0;
  const deps = {
    statusStore: {
      async load() {
        return previous;
      },
      async save(snapshot) {
        saved.push(snapshot);
      },
    },
    pushSender: {
      async send(cardNo, notice) {
        notices.push({ cardNo, notice });
        await send?.(cardNo, notice);
      },
    },
    createScraper() {
      return {
        async getUserStatus() {
          statusReads += 1;
          return statusReads === 1 ? status : (afterExtension ?? status);
        },
        async extendLoan() {
          return new Response(null, { status: 302 });
        },
        async getNewBooks() {
          throw new Error('not used');
        },
        async reserveBook() {
          throw new Error('not used');
        },
      };
    },
    today,
    now: () => new Date('2026-10-27T09:00:00.000Z'),
  };
  return { deps, saved, notices };
}

test('extends eligible loans and alerts for loans that cannot be extended', async () => {
  const beforeExtension = {
    borrowedBooks: [
      borrowedBook({
        barcode: 'extendable',
        status: '再貸出',
        returnOn: '2026-10-29',
      }),
      borrowedBook({
        barcode: 'not-extendable',
        returnOn: '2026-10-28',
      }),
    ],
    reservedBooks: [],
  };
  const afterExtension = {
    ...beforeExtension,
    borrowedBooks: [
      borrowedBook({
        barcode: 'extendable',
        status: '再貸出',
        returnOn: '2026-11-12',
      }),
      beforeExtension.borrowedBooks[1],
    ],
  };
  const { deps, saved, notices } = dependencies({
    status: beforeExtension,
    afterExtension,
  });

  const result = await runKeeper(secret, deps);

  assert.equal(result.extendedBookCount, 1);
  assert.equal(result.notificationCount, 1);
  assert.equal(notices[0].notice.type, 'return-due');
  assert.equal(notices[0].notice.bookTitle, 'not-extendable');
  assert.equal(saved.length, 1);
  assert.equal(saved[0].users[0].borrowedBooks[0].returnDate, '2026-11-12');
});

test('notifies only when a reservation first becomes held', async () => {
  const previous = {
    lastUpdated: '2026-10-26T09:00:00.000Z',
    users: [
      {
        cardNo: user.cardNo,
        name: user.name,
        borrowedBooks: [],
        reservedBooks: [
          {
            rank: '1/2',
            title: '既存の取置本',
            reservedOn: '2026-10-01',
            holdExpiresOn: '2026-10-30',
          },
          {
            rank: '2/2',
            title: '新たに取置済みになった本',
            reservedOn: '2026-10-10',
            holdExpiresOn: null,
          },
        ],
      },
    ],
  };
  const status = {
    borrowedBooks: [],
    reservedBooks: [
      reservedBook({
        title: '既存の取置本',
        reservedOn: '2026-10-01',
        expireOn: '2026-10-30',
      }),
      reservedBook({
        title: '新たに取置済みになった本',
        reservedOn: '2026-10-10',
        expireOn: '2026-10-31',
      }),
    ],
  };
  const { deps, notices, saved } = dependencies({ previous, status });

  await runKeeper(secret, deps);

  assert.equal(notices.length, 1);
  assert.equal(notices[0].notice.type, 'reservation-ready');
  assert.equal(notices[0].notice.bookTitle, '新たに取置済みになった本');
  assert.equal(saved.length, 1);
});

test('saves the latest snapshot even when push delivery fails', async () => {
  const status = {
    borrowedBooks: [],
    reservedBooks: [
      reservedBook({
        title: '取置済みの本',
        reservedOn: '2026-10-10',
        expireOn: '2026-10-31',
      }),
    ],
  };
  const { deps, saved } = dependencies({
    status,
    send: async () => {
      throw new Error('push failed');
    },
  });

  await assert.rejects(runKeeper(secret, deps), AggregateError);
  assert.equal(saved.length, 1);
  assert.equal(saved[0].users[0].reservedBooks[0].holdExpiresOn, '2026-10-31');
});
