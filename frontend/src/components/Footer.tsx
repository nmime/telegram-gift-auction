import { useTranslation } from 'react-i18next';

export default function Footer() {
  const { t } = useTranslation();

  return (
    <footer className="footer">
      <div className="footer-links">
        <a
          href="https://telegram-gift-auction.funfiesta.games"
          target="_blank"
          rel="noopener noreferrer"
          className="footer-link"
        >
          {t('footer.liveDemo')}
        </a>
        <a
          href="https://t.me/tggiftauctionbot"
          target="_blank"
          rel="noopener noreferrer"
          className="footer-link"
        >
          {t('footer.telegramBot')}
        </a>
        <a
          href="https://t.me/tggiftauctionbot/app"
          target="_blank"
          rel="noopener noreferrer"
          className="footer-link"
        >
          {t('footer.miniApp')}
        </a>
        <a
          href="https://telegram-gift-auction.funfiesta.games/api/docs"
          target="_blank"
          rel="noopener noreferrer"
          className="footer-link"
        >
          {t('footer.apiDocs')}
        </a>
        <a
          href="https://github.com/nmime/telegram-gift-auction"
          target="_blank"
          rel="noopener noreferrer"
          className="footer-link"
        >
          GitHub
        </a>
      </div>
      <div className="footer-author">
        <a
          href="https://t.me/nmime"
          target="_blank"
          rel="noopener noreferrer"
          className="footer-author-link"
          aria-label="Telegram"
        >
          <svg width="20" height="20" viewBox="0 0 256 256" fill="currentColor">
            <path d="M228.88,26.19a9,9,0,0,0-9.16-1.57L17.06,103.93a14.22,14.22,0,0,0,2.43,27.21L72,141.45V200a15.92,15.92,0,0,0,10,14.83,15.91,15.91,0,0,0,17.51-3.73l25.32-26.26L165,220a15.88,15.88,0,0,0,10.51,4,16.3,16.3,0,0,0,5-.79,15.85,15.85,0,0,0,10.67-11.63L231.77,35A9,9,0,0,0,228.88,26.19Zm-61.14,36L78.15,126.35l-49.6-9.73ZM88,200V152.52l24.79,21.74Zm87.53,8L100.85,135.5l119-85.29Z"/>
          </svg>
        </a>
        <a
          href="https://github.com/nmime"
          target="_blank"
          rel="noopener noreferrer"
          className="footer-author-link"
          aria-label="GitHub"
        >
          <svg width="20" height="20" viewBox="0 0 256 256" fill="currentColor">
            <path d="M208.31,75.68A59.78,59.78,0,0,0,202.93,28,8,8,0,0,0,196,24a59.75,59.75,0,0,0-48,24H108A59.75,59.75,0,0,0,60,24a8,8,0,0,0-6.93,4,59.78,59.78,0,0,0-5.38,47.68A58.14,58.14,0,0,0,40,104v8a56.06,56.06,0,0,0,48.44,55.47A39.8,39.8,0,0,0,80,192v8H72a24,24,0,0,1-24-24A40,40,0,0,0,8,136a8,8,0,0,0,0,16,24,24,0,0,1,24,24,40,40,0,0,0,40,40h8v32a8,8,0,0,0,16,0V192a24,24,0,0,1,48,0v56a8,8,0,0,0,16,0V192a39.8,39.8,0,0,0-8.44-24.53A56.06,56.06,0,0,0,200,112v-8A58.14,58.14,0,0,0,208.31,75.68ZM184,112a40,40,0,0,1-40,40H112a40,40,0,0,1-40-40v-8a41.74,41.74,0,0,1,6.9-22.48A8,8,0,0,0,80,73.55a43.81,43.81,0,0,1,.79-33.58,43.88,43.88,0,0,1,32.32,20.06A8,8,0,0,0,119.82,64h16.36a8,8,0,0,0,6.71-3.97,43.88,43.88,0,0,1,32.32-20.06A43.81,43.81,0,0,1,176,73.55a8,8,0,0,0,1.1,7.97A41.74,41.74,0,0,1,184,104Z"/>
          </svg>
        </a>
      </div>
      <div className="footer-copyright">
        {t('footer.madeWith')} <span className="footer-heart">♥</span> {t('footer.by')} nmime
      </div>
    </footer>
  );
}
