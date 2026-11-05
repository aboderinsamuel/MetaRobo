FROM node:22-bookworm-slim
ARG CLI_VERSION=1.3.1
RUN apt-get update && apt-get install -y --no-install-recommends curl ca-certificates tar && rm -rf /var/lib/apt/lists/*
RUN curl -fsSL https://downloads.arduino.cc/arduino-cli/arduino-cli_${CLI_VERSION}_Linux_64bit.tar.gz | tar -xz -C /usr/local/bin arduino-cli
ENV ARDUINO_DIRECTORIES_DATA=/opt/arduino/data ARDUINO_DIRECTORIES_USER=/opt/arduino/user
RUN arduino-cli core update-index && arduino-cli core install arduino:avr@1.8.6 && arduino-cli lib install Servo@1.2.2 LiquidCrystal@1.0.7 Stepper@1.1.3 && chmod -R a+rX /opt/arduino
WORKDIR /app
COPY server.mjs policy.mjs ./
USER node
EXPOSE 8080
CMD ["node", "server.mjs"]
