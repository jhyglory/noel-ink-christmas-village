#!/bin/bash
cd "$(dirname "$0")" || exit 1
if ! command -v node >/dev/null 2>&1; then
  echo "Node.js 20 이상을 설치한 뒤 다시 실행해 주세요."
  read -r -p "종료하려면 Enter를 누르세요."
  exit 1
fi
if [ ! -d node_modules/ws ]; then
  npm install || exit 1
fi
(sleep 2; open http://localhost:3000) &
npm start
