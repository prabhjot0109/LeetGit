/* Helper function to get the current LeetCode base URL */
function getLeetCodeBaseUrl() {
  const hostname = window.location.hostname;
  return `https://${hostname.includes('leetcode.cn') ? 'leetcode.cn' : 'leetcode.com'}`;
}

/* Enum for languages supported by LeetCode. */
const languages = {
  C: '.c',
  'C++': '.cpp',
  'C#': '.cs',
  Bash: '.sh',
  Cangjie: '.cj', // LeetCode CN specific
  Dart: '.dart',
  Elixir: '.ex',
  Erlang: '.erl',
  Go: '.go',
  Java: '.java',
  JavaScript: '.js',
  Javascript: '.js',
  Kotlin: '.kt',
  MySQL: '.sql',
  'MS SQL Server': '.sql',
  Oracle: '.sql',
  PHP: '.php',
  Pandas: '.py',
  PostgreSQL: '.sql',
  Python: '.py',
  Python3: '.py',
  Racket: '.rkt',
  Ruby: '.rb',
  Rust: '.rs',
  Scala: '.scala',
  Swift: '.swift',
  TypeScript: '.ts',
};

// Repo readme section markers for adding problems topic wise
const leetCodeSectionStart = `<!---LeetCode Topics Start-->`;
const leetCodeSectionHeader = `# LeetCode Topics`;
const leetCodeSectionEnd = `<!---LeetCode Topics End-->`;
const readmeFilename = 'README.md';
const defaultRepoReadme = 'Contains topicwise list of solved problems.\n\n';

// SubFolder
const basePath = 'LeetCode';

/* Difficulty of most recenty submitted question */
let difficulty = '';
/* Difficulty of most recenty submitted question */
let last_language = '';

/* state of upload for progress */
let uploadState = { uploading: false };

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

/* Serializes every read-modify-write of the `stats` key.
   A single submission fires several uploads concurrently (code, problem README, repo
   README), and each one used to do its own get-mutate-set. Whichever set landed last
   silently discarded the SHAs recorded by the others, which is how a file's blob SHA
   goes missing and the *next* push to it fails. */
let statsWriteQueue = Promise.resolve();
function mutateStats(mutator) {
  const run = statsWriteQueue.then(async () => {
    const { stats } = await chrome.storage.local.get('stats');
    const next = stats ?? { solved: 0, easy: 0, medium: 0, hard: 0, shas: {} };
    if (next.shas == null) {
      next.shas = {};
    }
    await mutator(next);
    await chrome.storage.local.set({ stats: next });
    return next;
  });
  // Keep the queue alive even if one mutation throws, or every later write deadlocks.
  statsWriteQueue = run.catch(() => {});
  return run;
}

/* Carries GitHub's own status and explanation instead of a bare status number, so a
   failure can be branched on programmatically *and* shown to the user verbatim. */
class GitHubError extends Error {
  constructor(status, body, url) {
    super(`${status}${body?.message ? `: ${body.message}` : ''}`);
    this.name = 'GitHubError';
    this.status = status;
    this.url = url;
  }
}

const githubRequest = async (url, token, init = {}) => {
  const res = await fetch(url, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github.v3+json',
      ...(init.headers || {}),
    },
  });
  const body = await res.json().catch(() => null);
  if (!res.ok) {
    throw new GitHubError(res.status, body, url);
  }
  return body;
};

/* The blob SHA GitHub currently holds for a path, or null when the file isn't there. */
const fetchRemoteSha = async (token, url) => {
  try {
    return (await githubRequest(url, token, { method: 'GET' }))?.sha ?? null;
  } catch (err) {
    if (err.status === 404) {
      return null;
    }
    throw err;
  }
};

/* returns today's date in MM-DD-YYYY format */
function getTodaysDate() {
  const today = new Date();
  const month = today.getMonth() + 1; // fix months are zero-indexed
  const day = today.getDate();
  const year = today.getFullYear();

  const formattedMonth = month < 10 ? '0' + month : month;
  const formattedDay = day < 10 ? '0' + day : day;

  return `${formattedMonth}-${formattedDay}-${year}`;
}

/* returns time in hh-mm-ss format */
function getTime() {
  const today = new Date();
  const hours = today.getHours();
  const minutes = today.getMinutes();
  const seconds = today.getSeconds();

  const formattedHours = hours < 10 ? '0' + hours : hours;
  const formattedMinutes = minutes < 10 ? '0' + minutes : minutes;
  const formattedSeconds = seconds < 10 ? '0' + seconds : seconds;

  return `${formattedHours}-${formattedMinutes}-${formattedSeconds}`;
}
/* returns the corresponding language from language extension */
function getLanguageFromExtension(extension) {
  if (extension === null || extension === undefined) {
    return null;
  }
  const language = Object.keys(languages).find(key => languages[key] === extension);
  console.log(language);
  return language || null;
}

/**
 * Constructs the full GitHub API URL to upload a file to a specific path in the repository.
 *
 * @param {string} hook - GitHub repository path in the format "username/repo".
 * @param {string} basePath - Base folder path where the file will be uploaded (e.g., "algorithm/LeetCode").
 * @param {string} difficulty - Problem difficulty (e.g., "Easy", "Medium", "Hard").
 * @param {string} problem - Problem slug or directory name (e.g., "0001-two-sum").
 * @param {string} filename - Name of the file to upload (e.g., "0001-two-sum.js").
 * @param {boolean} [useDifficultyFolder=true] - Whether to include the difficulty as a subfolder.
 * @param {boolean} useLanguageFolder - Whether to include the language as a subfolder.
 * @returns {string} Full GitHub API URL for the file upload.
 */

function constructGitHubPath(
  hook,
  basePath,
  difficulty,
  problem,
  filename,
  useDifficultyFolder,
  useLanguageFolder = false,
) {
  const filePath = problem ? `${problem}/${filename}` : `${filename}`;
  if (useLanguageFolder) {
    const language = last_language;
    console.log('Language:', language);
    if (language) {
      const path = useDifficultyFolder
        ? `${language}/${difficulty}/${filePath}`
        : `${language}/${filePath}`;
      return `https://api.github.com/repos/${hook}/contents/${path}`;
    }
  }
  const path = useDifficultyFolder ? `${basePath}/${difficulty}/${filePath}` : `${filePath}`;
  return `https://api.github.com/repos/${hook}/contents/${path}`;
}

const parseCustomCommitMessage = (text, problemContext) => {
  return text.replace(/{(\w+)}/g, (match, key) => {
    return Object.prototype.hasOwnProperty.call(problemContext, key) ? problemContext[key] : match;
  });
};

/* returns custom commit message or null if doesn't exist */
const getCustomCommitMessage = problemContext => {
  return new Promise((resolve, reject) => {
    chrome.storage.local.get('custom_commit_message', result => {
      if (chrome.runtime.lastError) {
        reject(chrome.runtime.lastError);
      } else if (!result.custom_commit_message || !result.custom_commit_message.trim()) {
        resolve(null); // no custom message is set
      } else {
        const finalCommitMessage = parseCustomCommitMessage(
          result.custom_commit_message,
          problemContext,
        );
        resolve(finalCommitMessage);
      }
    });
  });
};

/**
 * Appends a problem to the README file for a specific topic.
 * Creates a new topic if it doesn't exist. Creates a new README.md if it doesn't exist.
 *
 * @param {Array} topicTags - The topic tags in which the @p problemName is to be added.
 * @param {string} problemName - The name of the problem to be added.
 */
async function updateReadmeTopicTagsWithProblem(topicTags, problemName) {
  if (!topicTags) {
    console.log('No topic tags provided');
    return;
  }

  const { leethub_token, leethub_hook } = await chrome.storage.local.get([
    'leethub_token',
    'leethub_hook',
  ]);

  let readme = '';
  let newSha = '';

  try {
    const { content, sha } = await getUpdatedData(
      leethub_token,
      leethub_hook,
      '',
      readmeFilename,
      false,
    );
    newSha = sha;
    readme = decodeURIComponent(escape(atob(content)));
    await mutateStats(stats => {
      stats.shas[readmeFilename] = { '': sha };
    });
  } catch (err) {
    if (err.status === 404) {
      const initialContent = btoa(unescape(encodeURIComponent(defaultRepoReadme)));
      const uploadResponse = await upload(
        leethub_token,
        leethub_hook,
        initialContent,
        '',
        readmeFilename,
        null,
        'Initialize README.md',
        undefined,
        false,
      );
      newSha = uploadResponse.content.sha;
      readme = defaultRepoReadme;

      await mutateStats(stats => {
        stats.shas[readmeFilename] = { '': newSha };
      });
    } else {
      console.log(`Error fetching README: ${err.message}`);
      return;
    }
  }

  try {
    for (const topic of topicTags) {
      readme = await appendProblemToReadme(topic.name, readme, leethub_hook, problemName);
    }
    readme = sortTopicsInReadme(readme);
  } catch (err) {
    /* Rewriting the topic tables is string surgery over a file the user also edits by
       hand. It sat outside the try below, so one unexpected shape in the README aborted
       the whole submission — including the solution push that had nothing to do with it. */
    console.warn(`LeetGit: could not rebuild the repo README topics: ${err.message}`);
    return;
  }

  const encodedReadme = btoa(unescape(encodeURIComponent(readme)));
  try {
    return await upload(
      leethub_token,
      leethub_hook,
      encodedReadme,
      '',
      readmeFilename,
      newSha,
      `Add ${problemName} to topics.`,
      undefined,
      false,
    );
  } catch (err) {
    /* upload() already re-reads the SHA and retries on conflict, so anything reaching
       here is a genuine failure. The repo-wide topics README is a nice-to-have — never
       let it take the code push down with it. */
    console.warn(`LeetGit: could not update the repo README: ${err.message}`);
    return;
  }
}

/* Main function for uploading code to GitHub repo, and callback cb is called if success */
const upload = async (
  token,
  hook,
  code,
  problem,
  filename,
  sha,
  commitMsg,
  cb = undefined,
  useDifficultyFolder,
  useLanguageFolder,
) => {
  // const URL = `https://api.github.com/repos/${hook}/contents/${problem}/${filename}`;
  const URL = constructGitHubPath(
    hook,
    basePath,
    difficulty,
    problem,
    filename,
    useDifficultyFolder,
    useLanguageFolder,
  );

  /* An empty string is not a SHA; JSON.stringify drops the key when it's undefined,
     which is exactly what "create a new file" requires. */
  const put = blobSha =>
    githubRequest(URL, token, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: commitMsg, content: code, sha: blobSha || undefined }),
    });

  let response;
  try {
    response = await put(sha);
  } catch (err) {
    /* 409 means the SHA we held is stale; 422 means we sent none but the file already
       exists. Both say "our record of this file disagrees with GitHub", and both are
       repaired identically: ask GitHub for the current SHA and replay the write once.
       Previously only 409 was handled, and its recovery read the SHA through a helper
       that swallowed its own errors — so the retry re-sent the same broken request. */
    if (err.status !== 409 && err.status !== 422) {
      throw err;
    }
    console.warn(`LeetGit: ${filename} conflicted (${err.status}); re-reading SHA and retrying`);
    response = await put(await fetchRemoteSha(token, URL));
  }

  const committedSha = response?.content?.sha;
  if (committedSha) {
    await mutateStats(stats => {
      if (stats.shas[problem] == null) {
        stats.shas[problem] = {};
      }
      stats.shas[problem][filename] = committedSha;
    });
  }

  console.log(`LeetGit: committed ${filename}`);
  if (cb != undefined) {
    cb();
  }
  return response;
};

const incrementStats = () =>
  mutateStats(stats => {
    stats.solved = (stats.solved ?? 0) + 1;
    stats.easy = (stats.easy ?? 0) + (difficulty === 'Easy' ? 1 : 0);
    stats.medium = (stats.medium ?? 0) + (difficulty === 'Medium' ? 1 : 0);
    stats.hard = (stats.hard ?? 0) + (difficulty === 'Hard' ? 1 : 0);
  });

const checkAlreadyCompleted = async problemName => {
  const { stats } = await chrome.storage.local.get('stats');
  return stats?.shas?.[problemName] ?? false;
};

/* Main function for updating code on GitHub Repo */
/* Read from existing file on GitHub */
/* Discussion posts prepended at top of README */
/* Future implementations may require appending to bottom of file */
const update = async (
  token,
  hook,
  addition,
  problem,
  filename,
  commitMsg,
  shouldPreprendDiscussionPosts,
  cb = undefined,
  useDifficultyFolder,
  useLanguageFolder,
) => {
  let responseSHA = '';
  let existingContent = '';

  try {
    const data = await getUpdatedData(
      token,
      hook,
      problem,
      filename,
      useDifficultyFolder,
      useLanguageFolder,
    );
    responseSHA = data.sha;
    existingContent = decodeURIComponent(escape(atob(data.content)));
  } catch (err) {
    // A missing file isn't an error here — there is simply nothing to prepend to yet.
    if (err.status !== 404) {
      throw err;
    }
  }

  // https://web.archive.org/web/20190623091645/https://monsur.hossa.in/2012/07/20/utf-8-in-javascript.html
  // In order to preserve mutation of the data, we have to encode it, which is usually done in base64.
  // But btoa only accepts ASCII 7 bit chars (0-127) while Javascript uses 16-bit minimum chars (0-65535).
  // EncodeURIComponent converts the Unicode Points UTF-8 bits to hex UTF-8.
  // Unescape converts percent-encoded hex values into regular ASCII (optional; it shrinks string size).
  // btoa converts ASCII to base64.
  const newContent = btoa(
    unescape(
      encodeURIComponent(
        shouldPreprendDiscussionPosts ? addition + existingContent : existingContent,
      ),
    ),
  );

  return upload(
    token,
    hook,
    newContent,
    problem,
    filename,
    responseSHA,
    commitMsg,
    cb,
    useDifficultyFolder,
    useLanguageFolder,
  );
};

async function uploadGit(
  code,
  problemName,
  fileName,
  commitMsg,
  action,
  shouldPrependDiscussionPosts = false,
  cb = undefined,
  _diff = undefined,
) {
  // Assign difficulty
  if (_diff && _diff !== undefined) {
    difficulty = _diff.trim();
  }

  const { leethub_token: token } = await chrome.storage.local.get('leethub_token');
  if (token == undefined) {
    throw new Error('leethub token is undefined');
  }

  const { mode_type } = await chrome.storage.local.get('mode_type');
  if (mode_type !== 'commit') {
    throw new Error('leethub mode is not commit');
  }

  const { leethub_hook: hook } = await chrome.storage.local.get('leethub_hook');
  if (!hook) {
    throw new Error('leethub hook not defined');
  }

  const { useDifficultyFolder = false } = await chrome.storage.local.get('useDifficultyFolder');
  const { useLanguageFolder = false } = await chrome.storage.local.get('useLanguageFolder');

  if (action === 'update') {
    return update(
      token,
      hook,
      code,
      problemName,
      fileName,
      commitMsg,
      shouldPrependDiscussionPosts,
      cb,
      useDifficultyFolder,
      useLanguageFolder,
    );
  }

  /* Get SHA, if it exists. A stale or absent one is no longer fatal: upload() now
     re-reads the SHA from GitHub and retries on conflict. */
  const { stats } = await chrome.storage.local.get('stats');
  const sha = stats?.shas?.[problemName]?.[fileName] ?? '';

  return upload(
    token,
    hook,
    code,
    problemName,
    fileName,
    sha,
    commitMsg,
    cb,
    useDifficultyFolder,
    useLanguageFolder,
  );
}

/* Gets updated GitHub data for the specific file in repo in question.
   This throws a GitHubError on failure. It used to return `{}` for *any* error, which
   made every caller believe it had a valid record: `data.sha` was undefined, `404` was
   indistinguishable from success, and the conflict-recovery path silently re-sent the
   same request that had just been rejected. */
async function getUpdatedData(
  token,
  hook,
  problem,
  filename,
  useDifficultyFolder,
  useLanguageFolder,
) {
  const URL = constructGitHubPath(
    hook,
    basePath,
    difficulty,
    problem,
    filename,
    useDifficultyFolder,
    useLanguageFolder,
  );

  return githubRequest(URL, token, { method: 'GET' });
}

/* Turns a thrown error into something a user can act on, shown as the tooltip of the
   red ✗. A failed push used to leave only a bare status number in the page console,
   which made "nothing appeared on GitHub" impossible to tell apart from a rejected
   token, a wrong repo, or a submission that was never graded. */
function describePushFailure(err) {
  if (err == null) {
    return 'LeetGit: push failed.';
  }
  switch (err.status) {
    case 401:
      return 'LeetGit: GitHub rejected your Personal Access Token (401). Enter a new PAT in the extension popup.';
    case 403:
      return 'LeetGit: your token lacks write access to this repository (403). A fine-grained PAT needs "Contents: Read and write"; a classic PAT needs the "repo" scope.';
    case 404:
      return 'LeetGit: repository or path not found (404). Check the linked repo, and that your token is scoped to include it.';
    case 409:
    case 422:
      return `LeetGit: GitHub refused the write even after re-reading the file SHA (${err.status}). ${err.message}`;
    default:
      return `LeetGit: push failed — ${err.message ?? err}`;
  }
}

/* Checks if an elem/array exists and has length */
function checkElem(elem) {
  return elem && elem.length > 0;
}

function convertToSlug(string) {
  const a = 'àáâäæãåāăąçćčđďèéêëēėęěğǵḧîïíīįìłḿñńǹňôöòóœøōõőṕŕřßśšşșťțûüùúūǘůűųẃẍÿýžźż·/_,:;';
  const b = 'aaaaaaaaaacccddeeeeeeeegghiiiiiilmnnnnoooooooooprrsssssttuuuuuuuuuwxyyzzz------';
  const p = new RegExp(a.split('').join('|'), 'g');

  return string
    .toString()
    .toLowerCase()
    .replace(/\s+/g, '-') // Replace spaces with -
    .replace(p, c => b.charAt(a.indexOf(c))) // Replace special characters
    .replace(/&/g, '-and-') // Replace & with 'and'
    .replace(/[^\w-]+/g, '') // Remove all non-word characters
    .replace(/--+/g, '-') // Replace multiple - with single -
    .replace(/^-+/, '') // Trim - from start of text
    .replace(/-+$/, ''); // Trim - from end of text
}

function addLeadingZeros(title) {
  const maxTitlePrefixLength = 4;
  var len = title.split('-')[0].length;
  if (len < maxTitlePrefixLength) {
    return '0'.repeat(4 - len) + title;
  }
  return title;
}

function formatStats(time, timePercentile, space, spacePercentile) {
  return `Time: ${time} (${timePercentile}%), Space: ${space} (${spacePercentile}%) - LeetHub`;
}

function getGitIcon() {
  // Create an SVG element
  var gitSvg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  gitSvg.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
  gitSvg.setAttribute('width', '24');
  gitSvg.setAttribute('height', '24');
  gitSvg.setAttribute('viewBox', '0 0 114.8625 114.8625');

  // Create a path element inside the SVG
  var gitPath = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  gitPath.setAttribute('fill', '#100f0d');
  gitPath.setAttribute(
    'd',
    'm112.693375 52.3185-50.149-50.146875c-2.886625-2.88875-7.57075-2.88875-10.461375 0l-10.412625 10.4145 13.2095 13.2095C57.94975 24.759 61.47025 25.45475 63.9165 27.9015c2.461 2.462 3.150875 6.01275 2.087375 9.09375l12.732 12.7305c3.081-1.062 6.63325-.3755 9.09425 2.088875 3.4375 3.4365 3.4375 9.007375 0 12.44675-3.44 3.4395-9.00975 3.4395-12.45125 0-2.585375-2.587875-3.225125-6.387125-1.914-9.57275l-11.875-11.874V74.06075c.837375.415 1.628375.96775 2.326625 1.664 3.4375 3.437125 3.4375 9.007375 0 12.44975-3.4375 3.436-9.01125 3.436-12.44625 0-3.4375-3.442375-3.4375-9.012625 0-12.44975.849625-.848625 1.8335-1.490625 2.88325-1.920375V42.26925c-1.04975-.42975-2.03125-1.066375-2.88325-1.920875-2.6035-2.602625-3.23-6.424375-1.894625-9.622125L36.55325 17.701875 2.1660125 52.086125c-2.88818 2.891125-2.88818 7.57525 0 10.463875l50.1513625 50.146975c2.88725 2.88818125 7.569875 2.88818125 10.461375 0l49.914625-49.9146c2.889625-2.889125 2.889625-7.575625 0-10.463875',
  );

  gitSvg.appendChild(gitPath);
  return gitSvg;
}

function getToolTip() {
  var toolTip = document.createElement('div');
  toolTip.id = 'toolTip';
  toolTip.className = 'hidden';

  chrome.storage.local.get('dontShowToolTip').then(({ dontShowToolTip }) => {
    if (dontShowToolTip) {
      return toolTip;
    } else {
      toolTip.textContent =
        'You may select from earlier submissions to push. \r\n\r\n You may maintain multiple versions by adding a suffix with a right-click.';
      toolTip.className =
        'fixed bg-sd-popover text-sd-popover-foreground rounded-sd-md z-modal text-xs text-left font-normal whitespace-pre-line shadow w-48 p-2 border-sd-border border cursor-default translate-y-20 transition-opacity opacity-0 duration-300 group-hover:opacity-100';
      toolTip.appendChild(getDontShowContainer());
      toolTip.addEventListener('click', event => event.stopPropagation());
    }
  });
  return toolTip;
}

function getDontShowContainer() {
  var dontShowContainer = document.createElement('div');
  dontShowContainer.className = 'flex item-center justify-center gap-1 mt-2';

  var lable = document.createElement('label');
  lable.htmlFor = 'dontShowCheckBox';
  lable.textContent = 'dont show it again';

  var checkBox = document.createElement('input');
  checkBox.type = 'checkbox';
  checkBox.id = 'dontShowCheckBox';
  checkBox.addEventListener('click', function (event) {
    event.stopPropagation();
    if (this.checked) {
      chrome.storage.local.set({ dontShowToolTip: true });
      document.getElementById('toolTip').className = document
        .getElementById('toolTip')
        .className.replace('group-hover:opacity-100', '');
    }
  });

  dontShowContainer.appendChild(checkBox);
  dontShowContainer.appendChild(lable);
  return dontShowContainer;
}

/* Discussion Link - When a user makes a new post, the link is prepended to the README for that problem.*/
document.addEventListener('click', event => {
  const element = event.target;
  const oldPath = window.location.pathname;

  /* Act on Post button click */
  /* Complex since "New" button shares many of the same properties as "Post button */
  if (
    element.classList.contains('icon__3Su4') ||
    (element.parentElement != null &&
      (element.parentElement.classList.contains('icon__3Su4') ||
        element.parentElement.classList.contains('btn-content-container__214G') ||
        element.parentElement.classList.contains('header-right__2UzF')))
  ) {
    setTimeout(function () {
      /* Only post if post button was clicked and url changed */
      if (
        oldPath !== window.location.pathname &&
        oldPath === window.location.pathname.substring(0, oldPath.length) &&
        !Number.isNaN(window.location.pathname.charAt(oldPath.length))
      ) {
        const date = new Date();
        const currentDate = `${date.getDate()}/${date.getMonth()}/${date.getFullYear()} at ${date.getHours()}:${date.getMinutes()}`;
        const addition = `[Discussion Post (created on ${currentDate})](${window.location})  \n`;
        const problemName = window.location.pathname.split('/')[2]; // must be true.

        uploadGit(
          addition,
          problemName,
          'README.md',
          `Prepend discussion post: ${problemName}`,
          'update',
          true,
        );
      }
    }, 1000);
  }
});

function LeetCodeV1() {
  this.progressSpinnerElementId = 'leethub_progress_elem';
  this.progressSpinnerElementClass = 'leethub_progress';
  this.injectSpinnerStyle();
}
LeetCodeV1.prototype.init = async function () {};
/* Function for finding and parsing the full code. */
/* - At first find the submission details url. */
/* - Then send a request for the details page. */
/* - Parse the code from the html reponse. */
/* - Parse the stats from the html response (explore section) */
LeetCodeV1.prototype.findAndUploadCode = function (
  problemName,
  fileName,
  commitMsg,
  action,
  cb = undefined,
) {
  /* Get the submission details url from the submission page. */
  let submissionURL;
  const e = document.getElementsByClassName('status-column__3SUg');
  if (checkElem(e)) {
    // for normal problem submisson
    const submissionRef = e[1].innerHTML.split(' ')[1];
    submissionURL = getLeetCodeBaseUrl() + submissionRef.split('=')[1].slice(1, -1);
  } else {
    // for a submission in explore section
    const submissionRef = document.getElementById('result-state');
    submissionURL = submissionRef.href;
  }

  if (submissionURL == undefined) {
    return;
  }
  /* Request for the submission details page */
  return fetch(submissionURL)
    .then(res => {
      if (res.status == 200) {
        return res.text();
      } else {
        throw new Error('' + res.status);
      }
    })
    .then(responseText => {
      const doc = new DOMParser().parseFromString(responseText, 'text/html');
      /* the response has a js object called pageData. */
      /* Pagedata has the details data with code about that submission */
      const scripts = doc.getElementsByTagName('script');
      for (let i = 0; i < scripts.length; i++) {
        const text = scripts[i].innerText;
        if (text.includes('pageData')) {
          /* Extract the full code */
          const firstIndex = text.indexOf('submissionCode');
          const lastIndex = text.indexOf('editCodeUrl');
          let slicedText = text.slice(firstIndex, lastIndex);
          /* slicedText has form "submissionCode: 'Details code'" */
          /* Find the index of first and last single inverted coma. */
          const firstInverted = slicedText.indexOf("'");
          const lastInverted = slicedText.lastIndexOf("'");
          /* Extract only the code */
          const codeUnicoded = slicedText.slice(firstInverted + 1, lastInverted);
          /* The code has some unicode. Replacing all unicode with actual characters */
          const code = codeUnicoded.replace(/\\u[\dA-F]{4}/gi, function (match) {
            return String.fromCharCode(parseInt(match.replace(/\\u/g, ''), 16));
          });

          /* For a submission in explore section we do not get probStat beforehand.
            So, parse statistics from submisson page */
          if (!commitMsg) {
            slicedText = text.slice(text.indexOf('runtime'), text.indexOf('memory'));
            const resultRuntime = slicedText.slice(
              slicedText.indexOf("'") + 1,
              slicedText.lastIndexOf("'"),
            );
            slicedText = text.slice(text.indexOf('memory'), text.indexOf('total_correct'));
            const resultMemory = slicedText.slice(
              slicedText.indexOf("'") + 1,
              slicedText.lastIndexOf("'"),
            );
            commitMsg = `Time: ${resultRuntime}, Memory: ${resultMemory} - LeetHub`;
          }
          if (code != null) {
            return uploadGit(
              btoa(unescape(encodeURIComponent(code))),
              problemName,
              fileName,
              commitMsg,
              action,
              false,
              cb,
            );
          }
        }
      }
    });
};
// Returns the language extension
LeetCodeV1.prototype.getLanguageExtension = function () {
  const tag = [
    ...document.getElementsByClassName('ant-select-selection-selected-value'),
    ...document.getElementsByClassName('Select-value-label'),
  ];
  if (tag && tag.length > 0) {
    for (let i = 0; i < tag.length; i += 1) {
      const elem = tag[i].textContent;
      if (elem !== undefined && languages[elem] !== undefined) {
        return languages[elem];
      }
    }
  }
  return null;
};
LeetCodeV1.prototype.getLanguage = function () {
  const tag = [
    ...document.getElementsByClassName('ant-select-selection-selected-value'),
    ...document.getElementsByClassName('Select-value-label'),
  ];
  if (tag && tag.length > 0) {
    for (let i = 0; i < tag.length; i += 1) {
      const elem = tag[i].textContent;
      if (elem !== undefined && languages[elem] !== undefined) {
        return elem;
      }
    }
  }
  return '';
};
/* function to get the notes if there is any
 the note should be opened atleast once for this to work
 this is because the dom is populated after data is fetched by opening the note */
LeetCodeV1.prototype.getNotesIfAny = function () {
  // there are no notes on expore
  if (document.URL.startsWith(`${getLeetCodeBaseUrl()}/explore/`)) return '';

  let notes = '';
  if (
    checkElem(document.getElementsByClassName('notewrap__eHkN')) &&
    checkElem(
      document
        .getElementsByClassName('notewrap__eHkN')[0]
        .getElementsByClassName('CodeMirror-code'),
    )
  ) {
    const notesdiv = document
      .getElementsByClassName('notewrap__eHkN')[0]
      .getElementsByClassName('CodeMirror-code')[0];
    if (notesdiv) {
      for (let i = 0; i < notesdiv.childNodes.length; i++) {
        if (notesdiv.childNodes[i].childNodes.length == 0) continue;
        const text = notesdiv.childNodes[i].childNodes[0].innerText;
        if (text) {
          notes = `${notes}\n${text.trim()}`.trim();
        }
      }
    }
  }
  return notes.trim();
};
// Returns a slugged num+title variation e.g. 0001-two-sum
LeetCodeV1.prototype.getProblemNameSlug = function () {
  const questionElem = document.getElementsByClassName('content__u3I1 question-content__JfgR');
  const questionDescriptionElem = document.getElementsByClassName('question-description__3U1T');
  let questionTitle = 'unknown-problem';
  if (checkElem(questionElem)) {
    let qtitle = document.getElementsByClassName('css-v3d350');
    if (checkElem(qtitle)) {
      questionTitle = qtitle[0].innerHTML;
    }
  } else if (checkElem(questionDescriptionElem)) {
    let qtitle = document.getElementsByClassName('question-title');
    if (checkElem(qtitle)) {
      questionTitle = qtitle[0].innerText;
    }
  }
  return addLeadingZeros(convertToSlug(questionTitle));
};
/* Gets the success state of the solution and updates html elements with new classes */
LeetCodeV1.prototype.getSuccessStateAndUpdate = function () {
  const successTag = document.getElementsByClassName('success__3Ai7');
  const resultState = document.getElementById('result-state');

  // check success state for a normal problem
  if (
    checkElem(successTag) &&
    successTag[0].className === 'success__3Ai7' &&
    successTag[0].innerText.trim() === 'Success'
  ) {
    console.log(successTag[0]);
    successTag[0].classList.add('marked_as_success');
    return true;
  }
  // check success state for a explore section problem
  else if (
    resultState &&
    resultState.className === 'text-success' &&
    resultState.innerText === 'Accepted'
  ) {
    resultState.classList.add('marked_as_success');
    return true;
  }

  return false;
};
/* Parser function for time/space stats */
LeetCodeV1.prototype.parseStats = function () {
  const probStats = document.getElementsByClassName('data__HC-i');
  if (!checkElem(probStats)) {
    return null;
  }
  const time = probStats[0].textContent;
  const timePercentile = probStats[1].textContent;
  const space = probStats[2].textContent;
  const spacePercentile = probStats[3].textContent;

  return `Time: ${time} (${timePercentile}), Space: ${space} (${spacePercentile}) - LeetHub`;
};
/* Parser function for the question, question title, question difficulty, and tags */
LeetCodeV1.prototype.parseQuestion = function () {
  let questionUrl = window.location.href;
  if (questionUrl.endsWith('/submissions/')) {
    questionUrl = questionUrl.substring(0, questionUrl.lastIndexOf('/submissions/') + 1);
  }
  const questionElem = document.getElementsByClassName('content__u3I1 question-content__JfgR');
  const questionDescriptionElem = document.getElementsByClassName('question-description__3U1T');
  if (checkElem(questionElem)) {
    const qbody = questionElem[0].innerHTML;

    // Problem title.
    let qtitle = document.getElementsByClassName('css-v3d350');
    if (checkElem(qtitle)) {
      qtitle = qtitle[0].innerHTML;
    } else {
      qtitle = 'unknown-problem';
    }

    // Problem difficulty, each problem difficulty has its own class.
    const isHard = document.getElementsByClassName('css-t42afm');
    const isMedium = document.getElementsByClassName('css-dcmtd5');
    const isEasy = document.getElementsByClassName('css-14oi08n');

    if (checkElem(isEasy)) {
      difficulty = 'Easy';
    } else if (checkElem(isMedium)) {
      difficulty = 'Medium';
    } else if (checkElem(isHard)) {
      difficulty = 'Hard';
    }
    // Final formatting of the contents of the README for each problem
    const markdown = `<h2><a href="${questionUrl}">${qtitle}</a></h2><h3>${difficulty}</h3><hr>${qbody}`;
    return markdown;
  } else if (checkElem(questionDescriptionElem)) {
    let questionTitle = document.getElementsByClassName('question-title');
    if (checkElem(questionTitle)) {
      questionTitle = questionTitle[0].innerText;
    } else {
      questionTitle = 'unknown-problem';
    }

    const questionBody = questionDescriptionElem[0].innerHTML;
    const markdown = `<h2>${questionTitle}</h2><hr>${questionBody}`;

    return markdown;
  }
};
/* Injects a spinner on left side to the "Run Code" button */
LeetCodeV1.prototype.startSpinner = function () {
  try {
    let elem = document.getElementById('leethub_progress_anchor_element');
    if (!elem) {
      elem = document.createElement('span');
      elem.id = 'leethub_progress_anchor_element';
      elem.style = 'margin-right: 20px;padding-top: 2px;';
    }
    elem.innerHTML = `<div id="${this.progressSpinnerElementId}" class="${this.progressSpinnerElementClass}"></div>`;
    this.insertToAnchorElement(elem);
    uploadState.uploading = true;
  } catch (error) {
    console.log(error);
  }
};
/* Injects css style required for the upload progress indicator */
LeetCodeV1.prototype.injectSpinnerStyle = function () {
  const style = document.createElement('style');
  style.textContent = `.${this.progressSpinnerElementClass} {pointer-events: none;width: 2.0em;height: 2.0em;border: 0.4em solid transparent;border-color: #eee;border-top-color: #3E67EC;border-radius: 50%;animation: loadingspin 1s linear infinite;} @keyframes loadingspin { 100% { transform: rotate(360deg) }}`;
  document.head.append(style);
};
/* Inserts an anchor element that is specific to the page you are on (e.g. Explore) */
LeetCodeV1.prototype.insertToAnchorElement = function (elem) {
  if (document.URL.startsWith('${getLeetCodeBaseUrl()}/explore/')) {
    const action = document.getElementsByClassName('action');
    if (
      checkElem(action) &&
      checkElem(action[0].getElementsByClassName('row')) &&
      checkElem(action[0].getElementsByClassName('row')[0].getElementsByClassName('col-sm-6')) &&
      action[0].getElementsByClassName('row')[0].getElementsByClassName('col-sm-6').length > 1
    ) {
      const target = action[0]
        .getElementsByClassName('row')[0]
        .getElementsByClassName('col-sm-6')[1];
      elem.className = 'pull-left';
      if (target.childNodes.length > 0) target.childNodes[0].prepend(elem);
    }
  } else {
    if (checkElem(document.getElementsByClassName('action__38Xc'))) {
      const target = document.getElementsByClassName('action__38Xc')[0];
      elem.className = 'runcode-wrapper__8rXm';
      if (target.childNodes.length > 0) target.childNodes[0].prepend(elem);
    }
  }
};
/* Creates a ✔️ tick mark before "Run Code" button signaling LeetHub has done its job */
LeetCodeV1.prototype.markUploaded = function () {
  const elem = document.getElementById(this.progressSpinnerElementId);
  if (elem) {
    elem.className = '';
    elem.style =
      'display: inline-block;transform: rotate(45deg);height:24px;width:12px;border-bottom:7px solid #78b13f;border-right:7px solid #78b13f;';
  }
};
/* Creates a ❌ failed tick mark before "Run Code" button signaling that upload failed */
LeetCodeV1.prototype.markUploadFailed = function (reason) {
  const elem = document.getElementById(this.progressSpinnerElementId);
  if (elem) {
    elem.className = '';
    elem.style =
      'display: inline-block;transform: rotate(45deg);height:24px;width:12px;border-bottom:7px solid red;border-right:7px solid red;';
    elem.title = describePushFailure(reason);
  }
};
/* The problem slug currently on screen, e.g. "two-sum". */
function currentProblemSlug() {
  return window.location.pathname.match(/\/problems\/([^/]+)/)?.[1] ?? null;
}

/* Asks LeetCode for this problem's submission history and returns the newest accepted
   one (falling back to the newest of any status). Best effort: returns null rather
   than throwing, so the caller can report a single clear reason. */
async function fetchLatestSubmissionId(questionSlug) {
  const body = {
    operationName: 'submissionList',
    variables: { offset: 0, limit: 20, questionSlug },
    query: `query submissionList($offset: Int!, $limit: Int!, $questionSlug: String!) {
  questionSubmissionList(offset: $offset, limit: $limit, questionSlug: $questionSlug) {
    submissions {
      id
      statusDisplay
      timestamp
    }
  }
}`,
  };

  const submissions = await fetch(`${getLeetCodeBaseUrl()}/graphql/`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
    .then(res => res.json())
    .then(res => res?.data?.questionSubmissionList?.submissions ?? [])
    .catch(err => {
      console.warn('LeetGit: could not list earlier submissions', err);
      return [];
    });

  const accepted = submissions.find(s => s.statusDisplay === 'Accepted');
  return (accepted ?? submissions[0])?.id ?? null;
}

/* Works out which submission to push, in descending order of confidence:
     1. the id the interceptor captured from a submit made on this page,
     2. the id in the URL, when you are looking at one specific submission,
     3. the newest accepted submission for this problem.
   Only (1) existed before, which is why the "Push" button — whose tooltip offers to
   push earlier submissions — failed on every problem not submitted in this page load.
   The cached id is tied to the problem it came from, so navigating to a different
   problem and pushing can no longer commit the previous problem's code. */
async function resolveSubmissionId() {
  const slug = currentProblemSlug();

  if (window.leethubLastSubmissionId && window.leethubLastSubmissionSlug === slug) {
    return window.leethubLastSubmissionId;
  }

  const fromUrl = window.location.href.match(/\/submissions\/(\d+)/);
  if (fromUrl) {
    return fromUrl[1];
  }

  if (!slug) {
    throw new Error('LeetGit: could not tell which problem this page is for.');
  }

  const latest = await fetchLatestSubmissionId(slug);
  if (!latest) {
    throw new Error(
      `LeetGit: no submission found for "${slug}". Make sure you are signed in to LeetCode and have submitted this problem.`,
    );
  }
  console.log(`LeetGit: pushing your most recent submission (${latest}) for ${slug}`);
  return latest;
}

/**
 * Injects the interceptor script into the page's "Main World"
 * and listens for messages from the injected script.
 */
LeetCodeV2.prototype.injectAndListen = function () {
  window.addEventListener('leetHubSubmissionId', event => {
    console.log('[LeetHub] Received submission ID:', event.detail.submissionId);
    this.processSubmission(event.detail.submissionId);
  });

  window.addEventListener('leetHubSolutionPost', event => {
    const { questionSlug, content, title } = event.detail;
    console.log('LeetHub: Received solution post event:', event.detail);
    this.handleSolutionPost(questionSlug, content, title);
  });
};

/**
 * The main function that handles the entire commit process based on the submissionId.
 */
LeetCodeV2.prototype.processSubmission = async function (submissionId) {
  // Set the submissionId as a global variable so the existing init function can use it.
  // The slug is recorded with it: this page can outlive several problems in a SPA, and
  // an id kept from an earlier one would otherwise be pushed under the wrong problem.
  window.leethubLastSubmissionId = submissionId;
  window.leethubLastSubmissionSlug = currentProblemSlug();

  // Directly call the loader from the existing code.
  loader(this);
};

function LeetCodeV2() {
  this.submissionData;
  this.progressSpinnerElementId = 'leethub_progress_elem';
  this.progressSpinnerElementClass = 'leethub_progress';
  this.injectSpinnerStyle();
  this.addManualSubmitButton();
  this.injectAndListen();
}
LeetCodeV2.prototype.init = async function () {
  /* Throws with a specific reason rather than alert()-ing: a modal dialog blocks the
     page, and the old early `return` left submissionData null, which surfaced further
     down as an opaque TypeError instead of an explanation. */
  const submissionId = await resolveSubmissionId();
  // Query for getting the solution runtime and memory stats, the code, the coding language, the question id, question title and question difficulty
  const isCN = getLeetCodeBaseUrl() === 'https://leetcode.cn';
  const submissionDetailsQuery = {
    query: isCN
      ? `
query submissionDetails($submissionId: ID!) {
  submissionDetail(submissionId: $submissionId) {
    code
    timestamp
    statusDisplay
    isMine
    lang
    langVerboseName
    runtimeDisplay: runtime
    memoryDisplay: memory

    memory: rawMemory

    runtimePercentile
    memoryPercentile

    question {
      questionId
      titleSlug
      hasFrontendPreview
    }

    user {
      realName
      userAvatar
      userSlug
    }

    passedTestCaseCnt
    totalTestCaseCnt

    ... on GeneralSubmissionNode {
      outputDetail {
        codeOutput
        expectedOutput
        input
        compileError
        runtimeError # in outputDetail
        lastTestcase
      }
    }
  }
}`
      : '\n    query submissionDetails($submissionId: Int!) {\n  submissionDetails(submissionId: $submissionId) {\n    runtime\n    runtimeDisplay\n    runtimePercentile\n    runtimeDistribution\n    memory\n    memoryDisplay\n    memoryPercentile\n    memoryDistribution\n    code\n    timestamp\n    statusCode\n    lang {\n      name\n      verboseName\n    }\n    question {\n      questionId\n    questionFrontendId\n    title\n    titleSlug\n    content\n    difficulty\n    }\n    notes\n    topicTags {\n      tagId\n      slug\n      name\n    }\n    runtimeError\n  }\n}\n    ',
    variables: { submissionId: submissionId },
    operationName: 'submissionDetails',
  };
  const submissionDetailsOptions = {
    method: 'POST',
    headers: {
      cookie: document.cookie, // required to authorize the API request
      'content-type': 'application/json',
    },
    body: JSON.stringify(submissionDetailsQuery),
  };
  /* Poll until LeetCode has actually graded THIS submission.
     The DOM cannot be trusted as the "done" signal: on a problem you have solved
     before, the previous submission's result panel is on screen the instant the page
     loads, so getSuccessStateAndUpdate() reports success before the new submission has
     been judged. LeetCode answers this query with null while a submission is still in
     the queue, which is the one signal tied to this specific submissionId. */
  const hasSubmission = d => d != null && d.code != null && d.question != null;
  const isGraded = d => hasSubmission(d) && (d.runtimeDisplay != null || d.memoryDisplay != null);

  let submissionDetailsData = null;
  for (let attempt = 0; attempt < 20; attempt++) {
    const details = await fetch(`${getLeetCodeBaseUrl()}/graphql/`, submissionDetailsOptions)
      .then(res => res.json())
      .then(res => (isCN ? res?.data?.submissionDetail : res?.data?.submissionDetails))
      .catch(err => {
        console.warn('LeetGit: submissionDetails query failed, retrying', err);
        return null;
      });

    if (isGraded(details)) {
      submissionDetailsData = details;
      break;
    }
    // Keep the newest partial result: a rejected submission never reports runtime, and
    // we would rather commit it with incomplete stats than time out with nothing.
    if (hasSubmission(details)) {
      submissionDetailsData = details;
    }
    await sleep(1000);
  }

  if (!hasSubmission(submissionDetailsData)) {
    throw new Error(
      `LeetGit: LeetCode never returned details for submission ${submissionId} (still judging, or the request was rejected)`,
    );
  }

  console.info('LeetHub:', { submissionDetailsData });
  this.submissionData = submissionDetailsData;

  const questionDetailsQuery = {
    query:
      '\n    query questionDetail($titleSlug: String!) {\n  question(titleSlug: $titleSlug) {\n    title\n    titleSlug\n    questionId\n    questionFrontendId\n    questionTitle\n    translatedTitle\n    content\n    translatedContent\n    categoryTitle\n    difficulty\n    stats\n    topicTags {\n      name\n      slug\n      translatedName\n    }\n  }\n}\n',
    variables: { titleSlug: this.submissionData.question.titleSlug },
    operationName: 'questionDetail',
  };
  const questionDetailsOptions = {
    method: 'POST',
    headers: {
      cookie: document.cookie,
      'content-type': 'application/json',
    },
    body: JSON.stringify(questionDetailsQuery),
  };
  const questionDetailsData = await fetch(
    getLeetCodeBaseUrl() + '/graphql/',
    questionDetailsOptions,
  )
    .then(res => res.json())
    .then(res => res.data.question);
  this.questionDetails = questionDetailsData;
};
LeetCodeV2.prototype.findAndUploadCode = function (
  problemName,
  fileName,
  commitMsg,
  action,
  cb = undefined,
) {
  const code = this.getCode();
  if (!code) {
    throw new Error('No solution code found');
  }

  return uploadGit(
    btoa(unescape(encodeURIComponent(code))),
    problemName,
    fileName,
    commitMsg,
    action,
    false,
    cb,
  );
};
LeetCodeV2.prototype.getCode = function () {
  if (this.submissionData != null) {
    return this.submissionData.code;
  }

  const code = document.getElementsByTagName('code');
  if (!checkElem(code)) {
    return null;
  }

  return code[0].innerText;
};
LeetCodeV2.prototype.getLanguageExtension = function () {
  if (this.submissionData != null) {
    return languages[this.submissionData.lang.verboseName ?? this.submissionData.langVerboseName];
  }

  const tag = document.querySelector('button[id^="headlessui-listbox-button"]');
  if (!tag) {
    throw new Error('No language button found');
  }

  const lang = tag.innerText;
  if (languages[lang] === undefined) {
    throw new Error('Unknown Language: ' + { lang });
  }

  return languages[lang];
};
LeetCodeV2.prototype.getLanguage = function () {
  if (this.submissionData != null) {
    /* leetcode.cn returns a flat `langVerboseName`, not a `lang` object — the same
       shape difference getLanguageExtension already accounts for. This drives the
       language subfolder, so getting it wrong misfiles the solution. */
    return this.submissionData.lang?.verboseName ?? this.submissionData.langVerboseName ?? '';
  }
  return '';
};

LeetCodeV2.prototype.getNotesIfAny = function () {};

LeetCodeV2.prototype.extractQuestionNumber = function () {
  return this.submissionData.question.questionFrontendId ?? this.submissionData.question.questionId;
};

/**
 * Gets a formatted problem name slug from the LeetCodeV2 instance.
 * @returns {string} A string combining the problem number and the slug title.
 */
LeetCodeV2.prototype.getProblemNameSlug = function () {
  const slugTitle = this.submissionData.question.titleSlug;
  const qNum = this.extractQuestionNumber();
  return addLeadingZeros(qNum + '-' + slugTitle);
};

LeetCodeV2.prototype.getSuccessStateAndUpdate = function () {
  const successTag = document.querySelectorAll('[data-e2e-locator="submission-result"]');
  if (checkElem(successTag)) {
    console.log(successTag[0]);
    successTag[0].classList.add('marked_as_success');
    return true;
  }
  return false;
};
LeetCodeV2.prototype.parseStats = function () {
  if (this.submissionData != null) {
    const runtimePercentile =
      Math.round((this.submissionData.runtimePercentile + Number.EPSILON) * 100) / 100;
    const spacePercentile =
      Math.round((this.submissionData.memoryPercentile + Number.EPSILON) * 100) / 100;
    return {
      time: this.submissionData.runtimeDisplay,
      timePercentile: runtimePercentile,
      space: this.submissionData.memoryDisplay,
      spacePercentile: spacePercentile,
      problemTopic: this.questionDetails?.topicTags?.[0]?.name ?? 'UNKNOWN',
    };
  }

  /* Fallback for when the API gave us nothing. The container below is a LeetCode
     layout class that changes often; indexing [0].innerText blindly is what turned a
     missing submission into an unreadable "cannot read properties of undefined". */
  const statsContainer = document.getElementsByClassName('flex w-full pb-4')[0];
  if (!statsContainer) {
    throw new Error('LeetGit: no submission stats available from the API or the page');
  }
  const probStats = statsContainer.innerText.split('\n');
  if (!checkElem(probStats)) {
    return null;
  }

  const time = probStats[1];
  const timePercentile = probStats[3];
  const space = probStats[5];
  const spacePercentile = probStats[7];

  return formatStats(time, timePercentile, space, spacePercentile);
};
LeetCodeV2.prototype.parseQuestion = function () {
  let markdown;
  if (this.submissionData != null) {
    const questionUrl = window.location.href.split('/submissions')[0];
    const qTitle = `${this.extractQuestionNumber()}. ${this.submissionData.question.title}`;
    const qBody = this.parseQuestionDescription();

    difficulty = this.submissionData.question.difficulty;

    // Final formatting of the contents of the README for each problem
    markdown = `<h2><a href="${questionUrl}">${qTitle}</a></h2><h3>${difficulty}</h3><hr>${qBody}`;
  } else {
    // TODO: get the README markdown via scraping. Right now this isn't possible.
    markdown = null;
  }

  return markdown;
};
LeetCodeV2.prototype.parseQuestionTitle = function () {
  if (this.submissionData != null) {
    return this.submissionData.question.title;
  }

  let questionTitle = document
    .getElementsByTagName('title')[0]
    .innerText.split(' ')
    .slice(0, -2)
    .join(' ');

  if (questionTitle === '') {
    questionTitle = 'unknown-problem';
  }

  return questionTitle;
};
LeetCodeV2.prototype.parseQuestionDescription = function () {
  if (this.submissionData != null) {
    return this.submissionData.question.content;
  }

  const description = document.getElementsByName('description');
  if (!checkElem(description)) {
    return null;
  }
  return description[0].content;
};
LeetCodeV2.prototype.parseDifficulty = function () {
  if (this.submissionData != null) {
    return this.submissionData.question.difficulty;
  }

  const diffElement = document.getElementsByClassName('mt-3 flex space-x-4');
  if (checkElem(diffElement)) {
    return diffElement[0].children[0].innerText;
  }
  // Else, we're not on the description page. Nothing we can do.
  return 'unknown';
};
LeetCodeV2.prototype.startSpinner = function () {
  let elem = document.getElementById('leethub_progress_anchor_element');
  if (!elem) {
    elem = document.createElement('span');
    elem.id = 'leethub_progress_anchor_element';
    elem.style = 'margin-right: 20px;padding-top: 2px;';
  }
  elem.innerHTML = `<div id="${this.progressSpinnerElementId}" class="${this.progressSpinnerElementClass}"></div>`;
  this.insertToAnchorElement(elem);
  uploadState.uploading = true;
};
LeetCodeV2.prototype.injectSpinnerStyle = function () {
  const style = document.createElement('style');
  style.textContent = `.${this.progressSpinnerElementClass} {pointer-events: none;width: 2.0em;height: 2.0em;border: 0.4em solid transparent;border-color: #eee;border-top-color: #3E67EC;border-radius: 50%;animation: loadingspin 1s linear infinite;} @keyframes loadingspin { 100% { transform: rotate(360deg) }}`;
  document.head.append(style);
};
LeetCodeV2.prototype.insertToAnchorElement = function (elem) {
  if (document.URL.startsWith('${getLeetCodeBaseUrl()}/explore/')) {
    // TODO: support spinner when answering problems on Explore pages
    //   action = document.getElementsByClassName('action');
    //   if (
    //     checkElem(action) &&
    //     checkElem(action[0].getElementsByClassName('row')) &&
    //     checkElem(action[0].getElementsByClassName('row')[0].getElementsByClassName('col-sm-6')) &&
    //     action[0].getElementsByClassName('row')[0].getElementsByClassName('col-sm-6').length > 1
    //   ) {
    //     target = action[0].getElementsByClassName('row')[0].getElementsByClassName('col-sm-6')[1];
    //     elem.className = 'pull-left';
    //     if (target.childNodes.length > 0) target.childNodes[0].prepend(elem);
    //   }
    return;
  }

  if (checkElem(document.getElementsByClassName('ml-auto'))) {
    const target = document.getElementsByClassName('ml-auto')[0];
    elem.className = 'runcode-wrapper__8rXm';
    if (target.childNodes.length > 0) target.prepend(elem);
  }
};
LeetCodeV2.prototype.markUploaded = function () {
  let elem = document.getElementById(this.progressSpinnerElementId);
  if (elem) {
    elem.className = '';
    elem.style =
      'display: inline-block;transform: rotate(45deg);height:24px;width:12px;border-bottom:7px solid #78b13f;border-right:7px solid #78b13f;';
  }
};
LeetCodeV2.prototype.markUploadFailed = function (reason) {
  let elem = document.getElementById(this.progressSpinnerElementId);
  if (elem) {
    elem.className = '';
    elem.style =
      'display: inline-block;transform: rotate(45deg);height:24px;width:12px;border-bottom:7px solid red;border-right:7px solid red;';
    elem.title = describePushFailure(reason);
  }
};

LeetCodeV2.prototype.addManualSubmitButton = function () {
  let elem = document.getElementById('manualGitSubmit');
  const domain = document.URL.match(/:\/\/(www\.)?(.[^/:]+)/)[2].split('.')[0];
  if (elem || domain != 'leetcode') {
    return;
  }

  var submitButton = document.createElement('button');
  submitButton.id = 'manualGitSubmit';
  submitButton.className =
    'relative inline-flex gap-2 items-center justify-center font-medium cursor-pointer focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-50 transition-colors bg-transparent enabled:hover:bg-fill-secondary enabled:active:bg-fill-primary text-caption rounded text-text-primary group ml-auto p-1';
  submitButton.textContent = 'Push ';
  submitButton.appendChild(getGitIcon());
  submitButton.appendChild(getToolTip());
  submitButton.addEventListener('click', () => loader(this));
  submitButton.addEventListener('contextmenu', event => {
    event.preventDefault();
    const suffix = prompt(
      'Add a suffix for this solution file, i.e., -bfs, -dfs. \r\nWe don\'recommend includes special character except for "-".',
    );
    if (isValidSuffix(suffix)) {
      loader(this, suffix);
    }
  });

  let notesIcon = document.querySelectorAll('.ml-auto svg.fa-bookmark');
  if (checkElem(notesIcon)) {
    const target = notesIcon[0].closest('button.ml-auto').parentElement;
    target.prepend(submitButton);
  }
};

/* Validate if string can be added as suffix. Can add more constrains if necessary. */
function isValidSuffix(string) {
  if (!string || string.length > 255) {
    return false;
  }
  return true;
}

LeetCodeV2.prototype.addUrlChangeListener = function () {
  window.navigation.addEventListener('navigate', _ => {
    const problem = window.location.href.match(/leetcode\.(com|cn)\/problems\/(.*)\/submissions/);
    const submissionId = window.location.href.match(/\/(\d+)(\/|\?|$)/);
    if (problem && problem.length > 2 && submissionId && submissionId.length > 1) {
      chrome.storage.local.set({ [problem[2]]: submissionId[1] });
    }
  });
};

/* One-time migration of settings left in chrome.storage.sync by older versions.
   `leethub_token` is deliberately NOT migrated: those were OAuth tokens, which
   this version cannot use, and copying an absent/stale value over a PAT the user
   just entered in the popup would silently sign them out. Every key is checked
   for existence first, for the same reason. */
chrome.storage.local.get('isSync', data => {
  const keys = ['leethub_username', 'stats', 'leethub_hook', 'mode_type', 'custom_commit_message'];
  if (!data || !data.isSync) {
    keys.forEach(key => {
      chrome.storage.sync.get(key, synced => {
        if (synced && synced[key] !== undefined && synced[key] !== null) {
          chrome.storage.local.set({ [key]: synced[key] });
        }
      });
    });
    chrome.storage.local.set({ isSync: true }, _ => {
      console.log('LeetGit synced legacy settings to local storage');
    });
  } else {
    console.log('LeetGit local storage already synced!');
  }
});

const loader = (leetCode, suffix) => {
  let iterations = 0;
  // start upload indicator here
  leetCode.startSpinner();
  const intervalId = setInterval(async () => {
    try {
      const isSuccessfulSubmission = leetCode.getSuccessStateAndUpdate();
      if (!isSuccessfulSubmission) {
        iterations++;
        if (iterations <= 9) {
          return; // poll for max 10 attempts (10 seconds)
        }
        /* For V2 the result panel is only a hint. The submission is confirmed through
           the API in init(), and pushing an earlier submission from a page that shows
           no result at all is a supported case — so stop waiting on the DOM and let
           init() succeed or give a precise reason. */
        if (!(leetCode instanceof LeetCodeV2)) {
          clearInterval(intervalId);
          uploadState.uploading = false;
          leetCode.markUploadFailed(
            new Error('no submission result appeared on the page within 10s'),
          );
          return;
        }
      }

      // If successful, stop polling
      clearInterval(intervalId);

      // For v2, query LeetCode API for submission results
      await leetCode.init();

      const probStats = leetCode.parseStats();
      if (!probStats) {
        throw new Error('Could not get submission stats');
      }

      const probStatement = leetCode.parseQuestion();
      if (!probStatement) {
        throw new Error('Could not find problem statement');
      }

      const problemName = leetCode.getProblemNameSlug();
      const alreadyCompleted = await checkAlreadyCompleted(problemName);
      const language = leetCode.getLanguageExtension();
      if (!language) {
        throw new Error('Could not find language');
      }
      last_language = leetCode.getLanguage();

      /* Upload README */
      const updateReadMe = await chrome.storage.local.get('stats').then(({ stats }) => {
        const shaExists = stats?.shas?.[problemName]?.['README.md'] !== undefined;

        if (!shaExists) {
          return uploadGit(
            btoa(unescape(encodeURIComponent(probStatement))),
            problemName,
            'README.md',
            `Create readme : ${problemName}`,
            'upload',
            false,
          );
        }
      });

      /* Upload Notes if any*/
      let notes = leetCode.getNotesIfAny();
      let updateNotes;
      if (notes != undefined && notes.length > 0) {
        updateNotes = uploadGit(
          btoa(unescape(encodeURIComponent(notes))),
          problemName,
          'NOTES.md',
          `Attach Notes : ${problemName}`,
          'upload',
          false,
        );
      }

      const problemContext = {
        time: `${probStats.time} (${probStats.timePercentile}%)`,
        space: `${probStats.space} (${probStats.spacePercentile}%)`,
        language: language,
        problemName: problemName,
        difficulty: difficulty,
        date: getTodaysDate(),
        problemTopic: probStats.problemTopic,
      };
      const probStatsCommitMsg = `Time: ${probStats.time} (${probStats.timePercentile}%), Space: ${probStats.space} (${probStats.spacePercentile}%) - LeetHub`; // default commit
      const commitMsg = (await getCustomCommitMessage(problemContext)) || probStatsCommitMsg;

      const { useTimestampFilename = false } =
        await chrome.storage.local.get('useTimestampFilename');

      let fileName;
      if (useTimestampFilename) {
        const timestamp = `${getTodaysDate()}-${getTime()}`.replace(/[:\s]/g, '--');
        fileName = suffix
          ? `${problemName}${suffix}-${timestamp}${language}`
          : `${problemName}-${timestamp}${language}`;
      } else {
        fileName = suffix ? `${problemName}${suffix}${language}` : `${problemName}${language}`;
      }

      /* Upload code to Git */
      const updateCode = leetCode.findAndUploadCode(problemName, fileName, commitMsg, 'upload');

      /* Group problem into its relevant topics */
      const updateRepoReadMe = updateReadmeTopicTagsWithProblem(
        leetCode.questionDetails?.topicTags,
        problemName,
      );

      await Promise.all([updateReadMe, updateNotes, updateCode, updateRepoReadMe]);

      uploadState.uploading = false;
      leetCode.markUploaded();

      if (!alreadyCompleted) {
        incrementStats();
      }
    } catch (err) {
      uploadState.uploading = false;
      clearInterval(intervalId);
      leetCode.markUploadFailed(err);
      console.error('[LeetGit] push failed:', describePushFailure(err), err);
    }
  }, 1000);
};

// Use MutationObserver to determine when the submit button elements are loaded
const observer = new MutationObserver(function (_mutations, observer) {
  const v1SubmitBtn = document.querySelector('[data-cy="submit-code-btn"]');
  const v2SubmitBtn = document.querySelector('[data-e2e-locator="console-submit-button"]');
  const textareaList = document.getElementsByTagName('textarea');
  const textarea =
    textareaList.length === 4
      ? textareaList[2]
      : textareaList.length === 2
        ? textareaList[0]
        : textareaList[1];

  if (v1SubmitBtn) {
    observer.disconnect();

    const leetCode = new LeetCodeV1();
    v1SubmitBtn.addEventListener('click', () => loader(leetCode));
    return;
  }

  if (v2SubmitBtn && textarea) {
    observer.disconnect();

    new LeetCodeV2();
  }
});

setTimeout(() => {
  observer.observe(document.body, {
    childList: true,
    subtree: true,
  });
}, 2000);

/**
 * @param {string} topic - Topic to which the problem will be added.
 * @param {string} markdownFile - The markdown file content.
 * @param {string} hook - github hook (username/repo).
 * @param {string} problem - Problem name.
 *
 * @returns {string} - The updated markdown file content.
 */
async function appendProblemToReadme(topic, markdownFile, hook, problem) {
  const { useDifficultyFolder = false } = await chrome.storage.local.get('useDifficultyFolder');
  const { useLanguageFolder = false } = await chrome.storage.local.get('useLanguageFolder');
  const filePath = problem ? `${problem}/` : '';

  let path = '';
  if (useLanguageFolder) {
    const language = last_language;
    console.log('Language:', language);
    if (language) {
      path = useDifficultyFolder
        ? `${language}/${difficulty}/${filePath}`
        : `${language}/${filePath}`;
    } else {
      /* Returning '' here handed the caller an empty README, which it then encoded and
         pushed over the real one. Hand back the file untouched instead: a missing
         language only means we cannot link this row, not that the file has no content. */
      console.warn('LeetGit: no language recorded for problem, skipping topic row:', problem);
      return markdownFile;
    }
  } else {
    path = useDifficultyFolder ? `${basePath}/${difficulty}/${filePath}` : `${filePath}`;
  }

  const url = `https://github.com/${hook}/tree/main/${path}`;

  const topicHeader = `## ${topic}`;
  const topicTableHeader = `\n${topicHeader}\n| Problem Name | Difficulty |\n| ------- | ------- |\n`;
  const newRow = `| [${problem}](${url}) | ${difficulty} |\n`;

  // Check if the LeetCode Section exists, or add it
  let leetCodeSectionStartIndex = markdownFile.indexOf(leetCodeSectionStart);
  if (leetCodeSectionStartIndex === -1) {
    markdownFile +=
      '\n' + [leetCodeSectionStart, leetCodeSectionHeader, leetCodeSectionEnd].join('\n');
    leetCodeSectionStartIndex = markdownFile.indexOf(leetCodeSectionStart);
  }

  // Get LeetCode section and the Before & After sections
  const beforeSection = markdownFile.slice(0, markdownFile.indexOf(leetCodeSectionStart));
  const afterSection = markdownFile.slice(
    markdownFile.indexOf(leetCodeSectionEnd) + leetCodeSectionEnd.length,
  );

  let leetCodeSection = markdownFile.slice(
    markdownFile.indexOf(leetCodeSectionStart) + leetCodeSectionStart.length,
    markdownFile.indexOf(leetCodeSectionEnd),
  );

  // Check if topic table exists, or add it
  let topicTableIndex = leetCodeSection.indexOf(topicHeader);
  if (topicTableIndex === -1) {
    leetCodeSection += topicTableHeader;
    topicTableIndex = leetCodeSection.indexOf(topicHeader);
  }

  // Get the Topic table. If topic table was just added, then its end === LeetCode Section end
  const endTopicString = leetCodeSection.slice(topicTableIndex).match(/\|\n[^|]/)?.[0];
  const endTopicIndex =
    endTopicString != null ? leetCodeSection.indexOf(endTopicString, topicTableIndex + 1) : -1;
  let topicTable =
    endTopicIndex === -1
      ? leetCodeSection.slice(topicTableIndex)
      : leetCodeSection.slice(topicTableIndex, endTopicIndex + 1);
  topicTable = topicTable.trim();

  // Check if the problem exists in topic table, prevent duplicate add
  const problemIndex = topicTable.indexOf(problem);
  if (problemIndex !== -1) {
    return markdownFile;
  }

  // Append problem to the Topic
  topicTable = [topicTable, newRow, '\n'].join('\n');

  // Replace the old Topic table with the updated one in the markdown file
  leetCodeSection =
    leetCodeSection.slice(0, topicTableIndex) +
    topicTable +
    (endTopicIndex === -1 ? '' : leetCodeSection.slice(endTopicIndex + 1));

  markdownFile = [
    beforeSection,
    leetCodeSectionStart,
    leetCodeSection,
    leetCodeSectionEnd,
    afterSection,
  ].join('');

  return markdownFile;
}

// Sorts each Topic table by the problem number
function sortTopicsInReadme(markdownFile) {
  let beforeSection = markdownFile.slice(0, markdownFile.indexOf(leetCodeSectionStart));
  const afterSection = markdownFile.slice(
    markdownFile.indexOf(leetCodeSectionEnd) + leetCodeSectionEnd.length,
  );

  // Matches any text between the start and end tags. Should never fail to match.
  const leetCodeSection = markdownFile.match(
    new RegExp(`${leetCodeSectionStart}([\\s\\S]*)${leetCodeSectionEnd}`),
  )?.[1];
  if (leetCodeSection == null) throw new Error('LeetCodeTopicSectionNotFound');

  // Remove the header
  let topics = leetCodeSection.trim().split('## ');
  topics.shift();

  // Get Array<sorted-topic>
  topics = topics.map(section => {
    let lines = section.trim().split('\n');

    // Get the problem topic
    const topic = lines.shift();

    // Check if topic exists elsewhere
    let topicHeaderIndex = markdownFile.indexOf(`## ${topic}`);
    let leetCodeSectionStartIndex = markdownFile.indexOf(leetCodeSectionStart);
    if (topicHeaderIndex < leetCodeSectionStartIndex) {
      // matches the next '|\n' that doesn't precede a '|'. Typically this is '|\n#. Should always match if topic existed elsewhere.
      const endTopicString = markdownFile.slice(topicHeaderIndex).match(/\|\n[^|]/)?.[0];
      if (endTopicString == null) throw new Error('EndOfTopicNotFound');

      // Get the old problems for merge
      const endTopicIndex = markdownFile.indexOf(endTopicString, topicHeaderIndex + 1);
      const topicSection = markdownFile.slice(topicHeaderIndex, endTopicIndex + 1);
      const problemsToMerge = topicSection.trim().split('\n').slice(3);

      // Merge previously solved problems and removes duplicates
      lines = lines.concat(problemsToMerge).reduce((array, element) => {
        if (!array.includes(element)) {
          array.push(element);
        }
        return array;
      }, []);

      // Delete the old topic section after merging
      beforeSection =
        markdownFile.slice(0, topicHeaderIndex) +
        markdownFile.slice(endTopicIndex + 1, markdownFile.indexOf(leetCodeSectionStart));
    }

    // Remove the header and header separator
    lines = lines.slice(2);

    lines.sort((a, b) => {
      let numA = parseInt(a.match(/\/(\d+)-/)[1]);
      let numB = parseInt(b.match(/\/(\d+)-/)[1]);
      return numA - numB;
    });

    // Reconstruct the topic
    return ['## ' + topic]
      .concat('| Problem Name | Difficulty |', '| ------- | ------- |', lines)
      .join('\n');
  });

  // Reconstruct the file
  markdownFile =
    beforeSection +
    [leetCodeSectionStart, leetCodeSectionHeader, ...topics, leetCodeSectionEnd].join('\n') +
    afterSection;

  return markdownFile;
}

// Function to convert questionSlug to problemName using the same logic as LeetHub
async function questionSlugToProblemName(questionSlug) {
  // Query LeetCode GraphQL to get question details
  const questionDetailsQuery = {
    query: `
      query questionDetail($titleSlug: String!) {
        question(titleSlug: $titleSlug) {
          questionId
          questionFrontendId
          title
          titleSlug
        }
      }
    `,
    variables: { titleSlug: questionSlug },
    operationName: 'questionDetail',
  };

  const questionDetailsOptions = {
    method: 'POST',
    headers: {
      cookie: document.cookie,
      'content-type': 'application/json',
    },
    body: JSON.stringify(questionDetailsQuery),
  };

  try {
    const response = await fetch('https://leetcode.com/graphql/', questionDetailsOptions);
    const data = await response.json();
    const questionDetails = data.data.question;

    if (questionDetails) {
      const qNum = questionDetails.questionFrontendId;
      const slugTitle = questionDetails.titleSlug;
      return addLeadingZeros(qNum + '-' + slugTitle);
    }
  } catch (error) {
    console.error('Error fetching question details:', error);
  }

  // Fallback: try to extract from current problem name format
  return addLeadingZeros(convertToSlug(questionSlug));
}

// Function to get the last commit message for a problem by fetching from GitHub API
async function getLastCommitMessage(problemName) {
  try {
    const { stats } = await chrome.storage.local.get('stats');
    const { leethub_token } = await chrome.storage.local.get('leethub_token');
    const { leethub_hook } = await chrome.storage.local.get('leethub_hook');
    const { useDifficultyFolder = false } = await chrome.storage.local.get('useDifficultyFolder');
    const { useLanguageFolder = false } = await chrome.storage.local.get('useLanguageFolder');

    if (!stats?.shas || !leethub_token || !leethub_hook) {
      return 'Add solution post - LeetHub';
    }

    // Try to find the exact problem name, or one that contains the problem name
    let actualProblemName = problemName;
    if (!stats.shas[problemName]) {
      const availableProblems = Object.keys(stats.shas);

      // Try to find a problem that contains the slug or vice versa
      const questionSlugPart = problemName.replace(/^\d{4}-/, ''); // Remove leading number if present
      const matchingProblem = availableProblems.find(
        name =>
          name.includes(questionSlugPart) || questionSlugPart.includes(name.replace(/^\d{4}-/, '')),
      );

      if (matchingProblem) {
        actualProblemName = matchingProblem;
      } else {
        // Use the original problemName for GitHub API call even if not in stats
        actualProblemName = problemName;
      }
    }

    // Even if no solution files are found in local storage, still try to fetch from GitHub
    // because the stats might be incomplete or outdated

    // Construct the path for the problem folder based on user settings
    let folderPath = actualProblemName;

    // If using difficulty folders, we need to know the difficulty
    // For now, let's try to fetch commits for the problem folder regardless of organization
    if (useDifficultyFolder || useLanguageFolder) {
      // For complex folder structures, we'll search commits more broadly
      folderPath = problemName; // We'll search for any commits containing this problem name
    }

    // Fetch commits from GitHub API for this problem folder
    const commitsUrl = `https://api.github.com/repos/${leethub_hook}/commits?path=${folderPath}&per_page=10`;

    const options = {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${leethub_token}`,
        Accept: 'application/vnd.github.v3+json',
      },
    };

    try {
      const response = await fetch(commitsUrl, options);
      if (response.status === 200) {
        const commits = await response.json();

        if (commits && commits.length > 0) {
          // Find the most recent commit that's not for README.md, NOTES.md, or Solution.md
          for (const commit of commits) {
            const message = commit.commit.message;

            // Skip commits for README, NOTES, or previous solution posts
            if (
              message.includes('Create readme') ||
              message.includes('Attach Notes') ||
              message.includes('Prepend discussion') ||
              message.includes('solution post') ||
              message.includes('Add solution post')
            ) {
              continue;
            }

            // Look for commits that contain time/space stats (typical solution commits)
            if (
              message.includes('Time:') &&
              message.includes('Space:') &&
              message.includes('LeetHub')
            ) {
              return message;
            }

            // If it's not a README/NOTES/solution-post and doesn't have stats, it might still be a solution
            // (in case of custom commit messages or older format)
            return message;
          }
        }
      }
    } catch (apiError) {
      // Silently handle API errors
    }
    return 'Add solution post - LeetHub';
  } catch (error) {
    console.error('Error getting last commit message:', error);
    return 'Add solution post - LeetHub';
  }
}

// Function to handle solution post upload
LeetCodeV2.prototype.handleSolutionPost = async function (questionSlug, content, title) {
  try {
    // Check if auto-commit solution post is enabled (default: true)
    const { autoCommitSolutionPost = true } =
      await chrome.storage.local.get('autoCommitSolutionPost');

    if (!autoCommitSolutionPost) {
      console.log('Solution post auto-commit is disabled, skipping upload');
      return;
    }

    console.log('Processing solution post for:', questionSlug);

    const problemName = await questionSlugToProblemName(questionSlug);
    const commitMsg = await getLastCommitMessage(problemName);

    // Create the solution content with title
    const solutionContent = `# ${title}\n\n${content}`;

    // Upload the solution as Solution.md
    await uploadGit(
      btoa(unescape(encodeURIComponent(solutionContent))),
      problemName,
      'Solution.md',
      commitMsg,
      'upload',
      false,
    );

    console.log('Solution post uploaded successfully for:', problemName);
  } catch (error) {
    console.error('Error uploading solution post:', error);
  }
};

/*
// add url change listener & manual submit button if it does not exist already
setTimeout(() => {
  const leetCode = new LeetCodeV2();
  leetCode.addManualSubmitButton();
  leetCode.addUrlChangeListener();
}, 6000);
*/
