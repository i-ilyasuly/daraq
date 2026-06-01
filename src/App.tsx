/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { CenterLayout } from './components/CenterLayout';
import { Card } from './components/Card';
import { Typography } from './components/Typography';

export default function App() {
  return (
    <CenterLayout>
      <Card>
        <Typography variant="h1">Daraq AI Assistant</Typography>
        <Typography variant="body">
          Бұл қосымша Telegram бот ретінде жұмыс істейді. Сервер іске қосылды.
        </Typography>
        <Typography variant="caption">
          Толығырақ конфигурацияны жүйелік логтардан көре аласыз.
        </Typography>
      </Card>
    </CenterLayout>
  );
}
