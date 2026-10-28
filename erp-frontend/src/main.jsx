import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { App as AntApp, ConfigProvider } from 'antd';
import koKR from 'antd/locale/ko_KR';
import dayjs from 'dayjs';
import 'dayjs/locale/ko';
import App from './App';
import './index.css';

dayjs.locale('ko');

const theme = {
  token: {
    colorPrimary: '#1d4ed8',
    borderRadius: 6,
    fontFamily: "Pretendard, -apple-system, BlinkMacSystemFont, 'Malgun Gothic', sans-serif",
  },
  components: {
    Layout: { siderBg: '#0f172a', headerBg: '#ffffff' },
    Menu: { darkItemBg: '#0f172a', darkSubMenuItemBg: '#0b1222' },
    Table: { headerBg: '#f1f5f9' },
  },
};

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <ConfigProvider locale={koKR} theme={theme}>
      <AntApp>
        <BrowserRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
          <App />
        </BrowserRouter>
      </AntApp>
    </ConfigProvider>
  </React.StrictMode>
);
