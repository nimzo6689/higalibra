import { useEffect, useState } from 'react';
import JsBarcode from 'jsbarcode';
import {
  Bell,
  CircleAlert,
  LibraryBig,
  ScanBarcode,
} from 'lucide-react';
import { EmptyPanel } from '../components';
import type { LibraryUser } from '../types';
import { daysUntil, formatDate, formatDateTime } from '../utils';

export function BarcodePage({
  users,
  lastUpdated,
}: {
  users: LibraryUser[];
  lastUpdated?: string;
}) {
  const [selectedCardNo, setSelectedCardNo] = useState(users[0]?.cardNo ?? '');
  const selectedUser =
    users.find((user) => user.cardNo === selectedCardNo) ?? users[0];
  const cardNumber = selectedUser?.cardNo;

  useEffect(() => {
    if (!cardNumber) return;
    const element = document.getElementById('library-barcode');
    if (!(element instanceof SVGSVGElement)) return;
    try {
      JsBarcode(element, cardNumber, {
        format: 'CODE128',
        displayValue: false,
        height: 106,
        margin: 0,
        width: 2,
        background: '#ffffff',
        lineColor: '#19241d',
      });
    } catch (error) {
      console.error('Could not render library card barcode.', error);
    }
  }, [cardNumber]);

  if (!selectedUser) {
    return (
      <div className="page-stack barcode-page">
        <h1 className="legacy-page-heading">利用者のページ</h1>
        <EmptyPanel
          icon={<ScanBarcode size={24} />}
          title="利用者情報がありません"
          text="利用状況データを読み込んでください。"
        />
      </div>
    );
  }

  const readyBooks = selectedUser.reservedBooks.filter(
    (book) => book.holdExpiresOn !== null,
  );
  const dueBooks = selectedUser.borrowedBooks.filter(
    (book) => daysUntil(book.returnDate) <= 3,
  );

  return (
    <div className="page-stack barcode-page">
      <h1 className="legacy-page-heading">利用者のページ</h1>
      <section className="barcode-panel">
        <h2 className="barcode-panel-heading">
          <span className="barcode-panel-icon">
            <ScanBarcode size={19} />
          </span>
          利用券バーコード
        </h2>
        <div className="barcode-panel-content">
          <div className="member-tabs" role="tablist" aria-label="利用者を選択">
            {users.map((user, index) => (
              <button
                key={user.cardNo}
                className={`member-tab ${selectedUser.cardNo === user.cardNo ? 'selected' : ''}`}
                role="tab"
                aria-selected={selectedUser.cardNo === user.cardNo}
                onClick={() => setSelectedCardNo(user.cardNo)}
              >
                <span className={`avatar avatar-${index % 4}`}>
                  {user.name.slice(0, 1)}
                </span>
                {user.name}
              </button>
            ))}
          </div>
          <section className="library-card">
            <h3 className="library-card-heading">東村山市立図書館</h3>
            <div className="barcode-wrap">
              {cardNumber ? (
                <>
                  <svg
                    id="library-barcode"
                    aria-label={`${selectedUser.name}さんの図書館バーコード`}
                  />
                  <strong>{cardNumber}</strong>
                </>
              ) : (
                <div className="barcode-empty">
                  <CircleAlert size={20} />
                  <span>
                    カード番号が
                    <br />
                    データにありません
                  </span>
                </div>
              )}
              {lastUpdated && (
                <span className="barcode-updated">
                  (最終更新日時：{formatDateTime(lastUpdated)})
                </span>
              )}
            </div>
          </section>
        </div>
      </section>
      <div className="barcode-information">
        <section className="barcode-info-block">
          <h2>
            <Bell size={18} />
            お知らせ
          </h2>
          {readyBooks.length === 0 && dueBooks.length === 0 ? (
            <p className="barcode-info-empty">お知らせはありません</p>
          ) : (
            <ul>
              {readyBooks.map((book) => (
                <li key={`ready-${book.rank}`}>
                  「{book.title}」が取置済みです
                  {book.holdExpiresOn && (
                    <span>（取置期限：{formatDate(book.holdExpiresOn)}）</span>
                  )}
                </li>
              ))}
              {dueBooks.map((book) => (
                <li key={`due-${book.barcode}`}>
                  「{book.title}」の返却期限は{formatDate(book.returnDate)}です
                </li>
              ))}
            </ul>
          )}
        </section>
        <section className="barcode-info-block">
          <h2>
            <LibraryBig size={18} />
            利用情報
          </h2>
          <div className="barcode-usage">
            <p>
              貸出中の本：<strong>{selectedUser.borrowedBooks.length}</strong>冊
            </p>
            <p>
              予約中の本：<strong>{selectedUser.reservedBooks.length}</strong>冊
            </p>
          </div>
        </section>
      </div>
    </div>
  );
}
