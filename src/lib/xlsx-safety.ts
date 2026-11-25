import { crc32, inflateRawSync } from 'node:zlib';
import { HttpError } from './http-error';

export const MAX_XLSX_EXPANDED_BYTES = 20 * 1024 * 1024;
const MAX_ENTRIES = 512;
// 在交给Excel解析器之前验证ZIP目录，并使用硬输出上限解压验证实际数据。
// 不信任压缩包声称的原始大小；禁止DTD，避免小文件触发巨量解压或XML实体展开。
export function assertSafeXlsx(input: ArrayBuffer) {
  const bytes = Buffer.from(input);
  const invalid = () => new HttpError(400, 'Excel文件结构不正确，请另存为普通.xlsx文件后重试');
  const tooLarge = () => new HttpError(413, 'Excel解压后内容过大，请只保留需要导入的学生名单');
  function countBounded(text: string, pattern: RegExp, limit: number) {
    let count = 0;
    while (pattern.test(text)) if (++count > limit) throw tooLarge();
    return count;
  }
  try {
    const end = bytes.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
    if (
      end < 0 ||
      end + 22 > bytes.length ||
      end + 22 + bytes.readUInt16LE(end + 20) !== bytes.length
    )
      throw invalid();
    const count = bytes.readUInt16LE(end + 10);
    const centralSize = bytes.readUInt32LE(end + 12);
    const central = bytes.readUInt32LE(end + 16);
    if (
      bytes.readUInt16LE(end + 4) ||
      bytes.readUInt16LE(end + 6) ||
      bytes.readUInt16LE(end + 8) !== count ||
      !count ||
      count > MAX_ENTRIES ||
      central + centralSize !== end
    )
      throw invalid();
    let position = central,
      expanded = 0,
      cells = 0,
      strings = 0;
    const names = new Set<string>();
    for (let i = 0; i < count; i++) {
      if (position + 46 > end || bytes.readUInt32LE(position) !== 0x02014b50) throw invalid();
      const flags = bytes.readUInt16LE(position + 8);
      const method = bytes.readUInt16LE(position + 10);
      const checksum = bytes.readUInt32LE(position + 16);
      const size = bytes.readUInt32LE(position + 20);
      const originalSize = bytes.readUInt32LE(position + 24);
      const nameLength = bytes.readUInt16LE(position + 28);
      const recordLength =
        46 + nameLength + bytes.readUInt16LE(position + 30) + bytes.readUInt16LE(position + 32);
      const local = bytes.readUInt32LE(position + 42);
      if (
        position + recordLength > end ||
        local + 30 > central ||
        flags & 1 ||
        ![0, 8].includes(method)
      )
        throw invalid();
      const name = bytes.subarray(position + 46, position + 46 + nameLength).toString('utf8');
      if (
        !name ||
        names.has(name) ||
        name.startsWith('/') ||
        name.includes('\\') ||
        name.includes('\0') ||
        name.split('/').includes('..')
      )
        throw invalid();
      names.add(name);
      const extraEnd = position + 46 + nameLength + bytes.readUInt16LE(position + 30);
      for (let extra = position + 46 + nameLength; extra < extraEnd;) {
        if (extra + 4 > extraEnd) throw invalid();
        const kind = bytes.readUInt16LE(extra),
          length = bytes.readUInt16LE(extra + 2);
        if (extra + 4 + length > extraEnd) throw invalid();
        if (
          kind === 0x7075 &&
          (length < 5 || bytes.subarray(extra + 9, extra + 4 + length).toString('utf8') !== name)
        )
          throw invalid();
        extra += 4 + length;
      }
      if (originalSize > MAX_XLSX_EXPANDED_BYTES - expanded) throw tooLarge();
      if (
        bytes.readUInt32LE(local) !== 0x04034b50 ||
        bytes.readUInt16LE(local + 8) !== method ||
        bytes.readUInt16LE(local + 6) & 1
      )
        throw invalid();
      const localNameLength = bytes.readUInt16LE(local + 26);
      const dataStart = local + 30 + localNameLength + bytes.readUInt16LE(local + 28);
      if (
        dataStart + size > central ||
        bytes.subarray(local + 30, local + 30 + localNameLength).toString('utf8') !== name
      )
        throw invalid();
      const compressed = bytes.subarray(dataStart, dataStart + size);
      let data: Buffer;
      try {
        data =
          method === 0
            ? compressed
            : inflateRawSync(compressed, {
                maxOutputLength: Math.max(1, MAX_XLSX_EXPANDED_BYTES - expanded),
              });
      } catch (error) {
        if ((error as { code?: string }).code === 'ERR_BUFFER_TOO_LARGE') throw tooLarge();
        throw invalid();
      }
      expanded += data.byteLength;
      if (expanded > MAX_XLSX_EXPANDED_BYTES) throw tooLarge();
      if (data.byteLength !== originalSize || crc32(data) !== checksum) throw invalid();
      if (/\.(xml|rels)$/i.test(name) && /<!DOCTYPE|<!ENTITY/i.test(data.toString('utf8')))
        throw new HttpError(400, 'Excel含不支持的XML实体定义，请另存为普通表格');
      if (/^xl\/worksheets\/[^/]+\.xml$/i.test(name)) {
        const xml = data.toString('utf8');
        cells += countBounded(xml, /<c\b/g, 20000 - cells);
        countBounded(xml, /<row\b/g, 10000);
      }
      if (name === 'xl/sharedStrings.xml') {
        strings += countBounded(data.toString('utf8'), /<si\b/g, 50000 - strings);
      }
      position += recordLength;
    }
    if (position !== end || !names.has('[Content_Types].xml') || !names.has('xl/workbook.xml'))
      throw invalid();
  } catch (error) {
    if (error instanceof HttpError) throw error;
    throw invalid();
  }
}
