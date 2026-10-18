const ZIP32_MAX = 0xffffffff;
const UTF8_FLAG = 0x0800;
const DATA_DESCRIPTOR_FLAG = 0x0008;

const crcTable = new Uint32Array(256);
for (let n = 0; n < crcTable.length; n++) {
  let value = n;
  for (let bit = 0; bit < 8; bit++) value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
  crcTable[n] = value >>> 0;
}

function updateCrc(crc, buffer) {
  for (const byte of buffer) crc = crcTable[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return crc >>> 0;
}

function dosTimestamp(date) {
  const year = Math.max(1980, date.getFullYear());
  return {
    time: (date.getHours() << 11) | (date.getMinutes() << 5) | (Math.floor(date.getSeconds() / 2)),
    date: ((year - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate()
  };
}

function localHeader(name, flags, timestamp) {
  const header = Buffer.alloc(30 + name.length);
  header.writeUInt32LE(0x04034b50, 0);
  header.writeUInt16LE(20, 4);
  header.writeUInt16LE(flags, 6);
  header.writeUInt16LE(0, 8); // Store without compression so files can stream directly from Drive.
  header.writeUInt16LE(timestamp.time, 10);
  header.writeUInt16LE(timestamp.date, 12);
  header.writeUInt32LE(0, 14); // CRC is written in the data descriptor.
  header.writeUInt32LE(0, 18);
  header.writeUInt32LE(0, 22);
  header.writeUInt16LE(name.length, 26);
  header.writeUInt16LE(0, 28);
  name.copy(header, 30);
  return header;
}

function dataDescriptor(crc, size) {
  const descriptor = Buffer.alloc(16);
  descriptor.writeUInt32LE(0x08074b50, 0);
  descriptor.writeUInt32LE(crc, 4);
  descriptor.writeUInt32LE(size, 8);
  descriptor.writeUInt32LE(size, 12);
  return descriptor;
}

function centralHeader(entry) {
  const header = Buffer.alloc(46 + entry.name.length);
  header.writeUInt32LE(0x02014b50, 0);
  header.writeUInt16LE(20, 4);
  header.writeUInt16LE(20, 6);
  header.writeUInt16LE(entry.flags, 8);
  header.writeUInt16LE(0, 10);
  header.writeUInt16LE(entry.timestamp.time, 12);
  header.writeUInt16LE(entry.timestamp.date, 14);
  header.writeUInt32LE(entry.crc, 16);
  header.writeUInt32LE(entry.size, 20);
  header.writeUInt32LE(entry.size, 24);
  header.writeUInt16LE(entry.name.length, 28);
  header.writeUInt16LE(0, 30);
  header.writeUInt16LE(0, 32);
  header.writeUInt16LE(0, 34);
  header.writeUInt16LE(0, 36);
  header.writeUInt32LE(entry.directory ? 0x00100000 : 0, 38);
  header.writeUInt32LE(entry.offset, 42);
  entry.name.copy(header, 46);
  return header;
}

function endOfCentralDirectory(entryCount, centralSize, centralOffset) {
  const record = Buffer.alloc(22);
  record.writeUInt32LE(0x06054b50, 0);
  record.writeUInt16LE(0, 4);
  record.writeUInt16LE(0, 6);
  record.writeUInt16LE(entryCount, 8);
  record.writeUInt16LE(entryCount, 10);
  record.writeUInt32LE(centralSize, 12);
  record.writeUInt32LE(centralOffset, 16);
  record.writeUInt16LE(0, 20);
  return record;
}

function checkedOffset(offset, length) {
  const next = offset + length;
  if (next > ZIP32_MAX) throw new Error("Folder ZIP terlalu besar untuk format arsip yang didukung.");
  return next;
}

async function* createZipStream(entries, openFileStream) {
  if (entries.length > 0xffff) throw new Error("Folder berisi terlalu banyak item untuk satu ZIP.");
  let offset = 0;
  const centralEntries = [];
  const timestamp = dosTimestamp(new Date());

  for (const entry of entries) {
    const name = Buffer.from(entry.path, "utf8");
    if (name.length > 0xffff) throw new Error("Nama file terlalu panjang untuk ZIP.");
    const flags = UTF8_FLAG | (entry.directory ? 0 : DATA_DESCRIPTOR_FLAG);
    const localOffset = offset;
    const header = localHeader(name, flags, timestamp);
    offset = checkedOffset(offset, header.length);
    yield header;

    let crc = 0xffffffff;
    let size = 0;
    if (!entry.directory) {
      const source = await openFileStream(entry);
      try {
        for await (const chunk of source) {
          const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
          size += buffer.length;
          if (size > ZIP32_MAX) throw new Error("File terlalu besar untuk ZIP.");
          crc = updateCrc(crc, buffer);
          offset = checkedOffset(offset, buffer.length);
          yield buffer;
        }
      } finally {
        if (!source.destroyed) source.destroy();
      }
      crc = (crc ^ 0xffffffff) >>> 0;
      const descriptor = dataDescriptor(crc, size);
      offset = checkedOffset(offset, descriptor.length);
      yield descriptor;
    } else {
      crc = 0;
    }

    centralEntries.push({ name, flags, timestamp, crc, size, offset: localOffset, directory: entry.directory });
  }

  const centralOffset = offset;
  for (const entry of centralEntries) {
    const header = centralHeader(entry);
    offset = checkedOffset(offset, header.length);
    yield header;
  }
  const centralSize = offset - centralOffset;
  yield endOfCentralDirectory(centralEntries.length, centralSize, centralOffset);
}

module.exports = { createZipStream };
