/**
 * Imports
 */
const express = require('express');
const createWatcher = require('./watcher');
const createReader = require('./reader');
const createAnalyzer = require('./analyzer');
const createStore = require('./store');
const createRouter = require('./router');
const path = require('path');
const SocketIO = require('socket.io');
const Remote = require('./remote');

const roomMap = new WeakMap();
const DIRECTORY = './docs/';
const PORT = process.env.PORT || 0;
const REPO = process.env.HERMIONE_REPO;

/**
 * Hermione reads everything and determines useful relationships between
 * the content.
 *
 * @constructor
 * @param   {String|Regexp}   filePattern   File pattern or directory to watch
 */
module.exports = function hermione(cb) {
  if (!REPO) {
    process.stdout.write([
      '',
      '====================================================================',
      ` \u001b[1mHermione\u001b[22m requires an environment variable HERMIONE_REPO.`,
      ` See the documentation for further setup instructions.`,
      '',
      ` (∩｀-´)⊃━☆ﾟ.*･｡ﾟ \u001b[3m"Expelliarmus!"\u001b[23m`,
      '====================================================================',
      '',
    ].join('\n'));
    process.exit();
  }
  const app = express();
  const directory = path.resolve(DIRECTORY);
  const remote = new Remote(REPO, directory);

  const preClone = Date.now();
  remote.clone((e, x) => {
    console.log(`Repository cloned in ${Date.now() - preClone}ms`);
    const readFile = createReader(directory);
    const store = createStore();
    const analyzer = createAnalyzer(store);

    createRouter(app, store);

    const server = app.listen(PORT, () => {});

    server.on('listening', () => {
      const port = server.address().port;
      const spell = [
        'Accio Server',
        'Expecto Patronum',
        'Expelliarmus',
        'Petrificus Totalus',
        'Priori Incantato',
        'Wingardium Leviosa',
      ][Math.floor(6 * Math.random())];

      process.stdout.write([
        '',
        '====================================================================',
        ` \u001b[1mHermione\u001b[22m has started conjuring on port \u001b[1m${port}\u001b[22m.`,
        ` Watching on directory \u001b[1m${directory}\u001b[22m.`,
        '',
        ` (∩｀-´)⊃━☆ﾟ.*･｡ﾟ \u001b[3m"${spell}!"\u001b[23m`,
        '====================================================================',
        '',
      ].join('\n'));

      if (typeof cb === 'function') {
        cb();
      }
    });

    const io = SocketIO(server);

    io.on('connection', (socket) => {
      socket.emit('grab_room');
      socket.on('room', (room) => {
        const currentRoom = roomMap.get(socket);
        if (currentRoom) {
          socket.leave(currentRoom);
        }
        roomMap.set(socket, `hermione${room}`);
        socket.join(`hermione${room}`);
      });
      socket.on('disconnect', () => {});
    });

    let filesToStore = 0;
    createWatcher(directory, {
      updated: (file) => {
        console.log(file);
        filesToStore += 1;
        readFile(file)
          .then((content) => {
            store.updateFile(content);
            filesToStore -= 1;
            const interval = setInterval(() => {
              if (!filesToStore) {
                analyzer.linkContent(content);
                io.to(`hermione${content.uri}`).emit('page_updated');
                io.to('hermione/').emit('page_updated');
                content.tags.forEach((tag) => {
                  io.to(`hermione/tag/${tag}`).emit('page_updated');
                });
                clearInterval(interval);
              }
            }, 100);
          }).catch(() => {
            filesToStore -= 1;
          });
      },
      removed: (file) => {
        const content = store.getFile(file);
        analyzer.unlinkContent(file);
        store.removeFile(file);
        io.to(`hermione${content.uri}`).emit('page_removed');
        io.to('hermione/').emit('page_updated');
        content.tags.forEach((tag) => {
          io.to(`hermione/tag/${tag}`).emit('page_updated');
        });
      },
    });

    setInterval(() => {
      const now = Date.now();
      remote.sync(() => {
        console.log(`Synched in ${Date.now() - now}ms`);
      });
    }, 30000);
  });
};