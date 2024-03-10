FROM node:20
WORKDIR /server

RUN npm install -g ts-node
COPY ./package-lock.json .
COPY ./package.json .
RUN npm ci

COPY . .
EXPOSE 25565
RUN mkdir /temp
CMD ["npm", "start"]