let _player = null;
let _client = null;
let _io = null;

module.exports = {
  setPlayer: p => { _player = p; },
  getPlayer: () => _player,
  setClient: c => { _client = c; },
  getClient: () => _client,
  setIo: io => { _io = io; },
  getIo: () => _io,
};
