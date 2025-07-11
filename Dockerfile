FROM node:24
WORKDIR /server

COPY ./package-lock.json .
COPY ./package.json .
RUN npm ci --omit dev

COPY . .

RUN npx tsc --build
RUN find . -name "*.ts" -type f -delete
RUN find . -name "*.d.ts" -type f -delete

EXPOSE 25565
RUN mkdir /temp
CMD ["node", "index.js"]