// Release descriptions are generated from the current in-app news entry.
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { releases } from '../server/utils/news.mjs';

export function releaseNotes(version, release, repository, commit, previousTag) {
  if (!/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(version) || release.version !== version)
    throw Error('package.json version must be stable SemVer and match the newest news entry.');
  if (!/^[\w.-]+\/[\w.-]+$/.test(repository) || !/^[a-f0-9]{40}$/.test(commit)) throw Error('Invalid repository or commit.');
  const tag = `v${version}`;
  if (previousTag && !/^v\d+\.\d+\.\d+$/.test(previousTag)) throw Error('Invalid previous release tag.');
  if (previousTag) {
    const current = version.split('.').map(BigInt), previous = previousTag.slice(1).split('.').map(BigInt);
    const different = current.findIndex((part, index) => part !== previous[index]);
    if (different < 0 || current[different] < previous[different]) throw Error('Release version must increase.');
  }
  const url = `https://github.com/${repository}`;
  const render = value => {
    if (!value?.title || !value.summary || !value.sections?.length || value.sections.some(section => !section.title || !section.items?.length))
      throw Error('Both English and Russian release descriptions are required.');
    return `# QWS ${tag} — ${value.title}\n\n${value.summary}\n\n` + value.sections.map(section =>
      `## ${section.title}\n\n${section.items.map(item => `- ${item}`).join('\n')}`).join('\n\n');
  };
  const history = previousTag ? `${url}/compare/${previousTag}...${tag}` : `${url}/commits/${commit}`;
  const en = `${render(release.english)}\n\n[Русская версия / Russian release notes](${url}/releases/download/${tag}/RELEASE_NOTES.ru.md)\n\n## Installation\n\nDownload \`qws-dl-${tag}-source.tar.gz\`, extract it, copy \`.env.example\` to \`.env\`, and set administrator credentials. Run \`docker compose up -d --build\` from the extracted directory. Docker builds the complete Node/Python/audio runtime; Node alone is insufficient. See [setup instructions](${url}/blob/${tag}/INFO.md).\n\nVerify downloads with \`sha256sum -c SHA256SUMS\` in the directory containing all release assets. This is a source distribution, not a prebuilt container.\n\n[Full history](${history}) · Commit: [\`${commit.slice(0, 7)}\`](${url}/commit/${commit})\n`;
  const ru = `${render(release)}\n\n## Установка\n\nСкачайте \`qws-dl-${tag}-source.tar.gz\`, распакуйте, скопируйте \`.env.example\` в \`.env\` и задайте учётные данные администратора. Выполните \`docker compose up -d --build\`. Docker соберёт окружение Node/Python и аудиокодеки. Это архив исходников, а не готовый образ. [Инструкция](${url}/blob/${tag}/INFO.ru.md).\n\nСкачайте все файлы релиза в одну папку и проверьте их: \`sha256sum -c SHA256SUMS\`.\n\n[English release notes](${url}/releases/tag/${tag}) · [История изменений](${history}) · [Коммит ${commit.slice(0, 7)}](${url}/commit/${commit})\n`;
  return { tag, en, ru };
}

async function main() {
  const root = fileURLToPath(new URL('../', import.meta.url));
  const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
  const { version } = JSON.parse(await readFile(resolve(root, 'package.json'), 'utf8'));
  const commit = git('rev-parse', 'HEAD');
  const previousTag = git('tag', '--merged', 'HEAD', '--list', 'v*', '--sort=-version:refname').split('\n').find(tag => tag !== `v${version}` && /^v\d+\.\d+\.\d+$/.test(tag));
  const notes = releaseNotes(version, releases[0], process.env.GITHUB_REPOSITORY || 'DoshikKing/qws-dl', commit, previousTag);
  if (process.argv.includes('--tag')) { console.log(notes.tag); return; }
  // Archive committed files only; never include local data, sessions or build directories.
  git('diff', '--exit-code', 'HEAD', '--');
  const output = resolve(root, 'release');
  await mkdir(output, { recursive: true });
  const archive = `qws-dl-${notes.tag}-source.tar.gz`;
  git('archive', '--format=tar.gz', `--prefix=qws-dl-${notes.tag}/`, `--output=${resolve(output, archive)}`, 'HEAD');
  await writeFile(resolve(output, 'RELEASE_NOTES.en.md'), notes.en);
  await writeFile(resolve(output, 'RELEASE_NOTES.ru.md'), notes.ru);
  const files = [archive, 'RELEASE_NOTES.en.md', 'RELEASE_NOTES.ru.md'];
  const sums = await Promise.all(files.map(async name => `${createHash('sha256').update(await readFile(resolve(output, name))).digest('hex')}  ${name}\n`));
  await writeFile(resolve(output, 'SHA256SUMS'), sums.join(''));
  console.log(`Prepared ${notes.tag} at ${commit}`);
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
