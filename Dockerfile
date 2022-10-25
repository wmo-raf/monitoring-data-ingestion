FROM osgeo/gdal:ubuntu-small-latest

USER root

ENV DEBIAN_FRONTEND=noninteractive 

RUN apt-get update && apt-get install -y wget g++ gfortran make cdo cron

COPY ./build_wgrib.sh /
RUN /build_wgrib.sh

ENV NVM_DIR /usr/local/nvm
ENV NODE_VERSION 16.17.0

RUN mkdir -p $NVM_DIR
# install nvm
# https://github.com/creationix/nvm#install-script
RUN curl --silent -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.1/install.sh | bash \
    && . $NVM_DIR/nvm.sh \
    && nvm install $NODE_VERSION \
    && nvm alias default $NODE_VERSION \
    && nvm use default
# add node and npm to path so the commands are available
ENV NODE_PATH $NVM_DIR/v$NODE_VERSION/lib/node_modules
ENV PATH $NVM_DIR/versions/node/v$NODE_VERSION/bin:$PATH

# Fix cdo error
# https://askubuntu.com/questions/504546/error-message-source-not-found-when-running-a-script
RUN strip --remove-section=.note.ABI-tag /usr/lib/x86_64-linux-gnu/libQt5Core.so.5

ENV USER node

RUN addgroup $USER && useradd -ms /bin/bash $USER -g $USER
WORKDIR /home/node/app

COPY ./entrypoint.sh /home/node/app/entrypoint.sh
COPY package.json /home/node/package.json
COPY package-lock.json /home/node/package-lock.json
RUN npm install

COPY --chown=$USER:$USER . /home/node/app/

ENTRYPOINT ["./entrypoint.sh"]