const option = () => {
  return $('#type').val();
};

const repositoryName = () => {
  if (option() == 'new') return $('#name').val().trim();
  else return $('#existing_repo').val().trim();
};

/* Status codes for creating of repo */

const statusCode = (res, status, name) => {
  switch (status) {
    case 304:
      $('#success').hide();
      $('#error').text(`Error creating ${name} - Unable to modify repository. Try again later!`);
      $('#error').show();
      break;

    case 400:
      $('#success').hide();
      $('#error').text(
        `Error creating ${name} - Bad POST request, make sure you're not overriding any existing scripts`,
      );
      $('#error').show();
      break;

    case 401:
      $('#success').hide();
      $('#error').text(`Error creating ${name} - Unauthorized access to repo. Try again later!`);
      $('#error').show();
      break;

    case 403:
      $('#success').hide();
      $('#error').text(
        `Error creating ${name} - Your token is not allowed to create repositories. A fine-grained PAT needs "Administration: Read and write" and must be scoped to "All repositories"; a classic PAT needs the "repo" scope. Otherwise, create the repository on GitHub yourself and use "Link an Existing Repository".`,
      );
      $('#error').show();
      break;

    case 422:
      $('#success').hide();
      $('#error').text(
        `Error creating ${name} - Unprocessable Entity. Repository may have already been created. Try Linking instead (select 2nd option).`,
      );
      $('#error').show();
      break;

    default:
      /* Change mode type to commit */
      chrome.storage.local.set({ mode_type: 'commit' }, () => {
        $('#error').hide();
        $('#success').html(
          `Successfully created <a target="blank" href="${res.html_url}">${name}</a>. Start <a href="https://leetcode.com">LeetCoding</a> or <a href="https://leetcode.cn">力扣</a>!`,
        );
        $('#success').show();
        $('#unlink').show();
        /* Show new layout */
        document.getElementById('hook_mode').style.display = 'none';
        document.getElementById('commit_mode').style.display = 'inherit';
      });
      /* Set Repo Hook */
      chrome.storage.local.set({ leethub_hook: res.full_name }, () => {
        console.log('Successfully set new repo hook');
      });

      break;
  }
};

const createRepo = (token, name) => {
  const AUTHENTICATION_URL = 'https://api.github.com/user/repos';
  let data = {
    name,
    private: true,
    auto_init: true,
    description:
      'Collection of LeetCode questions to ace the coding interview! - Created using [LeetGit](https://github.com/prabhjot0109/LeetGit)',
  };
  data = JSON.stringify(data);

  const xhr = new XMLHttpRequest();
  xhr.addEventListener('readystatechange', function () {
    if (xhr.readyState === 4) {
      let res = {};
      try {
        res = JSON.parse(xhr.responseText);
      } catch {
        res = {};
      }
      statusCode(res, xhr.status, name);
    }
  });

  xhr.open('POST', AUTHENTICATION_URL, true);
  xhr.setRequestHeader('Authorization', `Bearer ${token}`);
  xhr.setRequestHeader('Accept', 'application/vnd.github.v3+json');
  xhr.send(data);
};

/* Status codes for linking of repo */
const linkStatusCode = (status, name) => {
  let bool = false;
  const repoLink = `<a target="blank" href="https://github.com/${name}">${name}</a>`;
  switch (status) {
    case 200:
    case 201:
      bool = true;
      break;

    case 301:
      $('#success').hide();
      $('#error').html(
        `Error linking ${repoLink} to LeetGit. <br> This repository has been moved permenantly. Try creating a new one.`,
      );
      $('#error').show();
      break;

    case 401:
      $('#success').hide();
      $('#error').html(
        `Error linking ${repoLink} to LeetGit. <br> Your Personal Access Token is invalid or has expired. Open the extension popup and enter a valid PAT.`,
      );
      $('#error').show();
      break;

    case 403:
      $('#success').hide();
      $('#error').html(
        `Error linking ${repoLink} to LeetGit. <br> Forbidden action. Make sure your token grants "Contents: Read and write" on this repository (fine-grained PAT) or the "repo" scope (classic PAT).`,
      );
      $('#error').show();
      break;

    case 404:
      $('#success').hide();
      $('#error').html(
        `Error linking ${repoLink} to LeetGit. <br> Resource not found. Make sure you entered the right repository name, and that your token is scoped to include this repository.`,
      );
      $('#error').show();
      break;

    default:
      $('#success').hide();
      $('#error').html(
        `Error linking ${repoLink} to LeetGit. <br> GitHub responded with HTTP ${status}. Please try again later.`,
      );
      $('#error').show();
      break;
  }
  $('#unlink').show();
  return bool;
};

/* Handle inputBox by type selection */
$('#type').change(function () {
  const selectedType = $(this).val();
  if (selectedType === 'link') {
    $('#name').hide();
    $('#existing_repo').show();
    loadRepositories();
  } else {
    $('#name').show();
    $('#existing_repo').hide();
  }
});

/* Load repositories from GitHub */
function loadRepositories() {
  chrome.storage.local.get('leethub_token', data => {
    const token = data.leethub_token;

    let repos = [];
    let page = 1;
    let hasNextPage = true;

    function fetchRepos() {
      $.ajax({
        url: 'https://api.github.com/user/repos',
        type: 'GET',
        data: {
          per_page: 100, // Max per_page to reduce the number of requests
          page: page, // Page number for pagination
          affiliation: 'owner',
        },
        headers: {
          Authorization: `Bearer ${token}`,
        },
        success: function (response, status, xhr) {
          repos = repos.concat(response);

          // Check for the next page by looking at the 'Link' header
          const linkHeader = xhr.getResponseHeader('Link');
          hasNextPage = linkHeader && linkHeader.includes('rel="next"');

          // If there's a next page, fetch the next page
          if (hasNextPage) {
            page++;
            fetchRepos(); // Recursively fetch the next page
          } else {
            // All repos have been fetched, populate the dropdown
            $('#existing_repo').empty().append('<option value="">Select a Repository</option>');
            repos.forEach(repo => {
              $('#existing_repo').append(`<option value="${repo.name}">${repo.name}</option>`);
            });
          }
        },
        error: function (xhr, status, error) {
          console.error('Failed to load repositories:', error);
          $('#error').text('Failed to load repositories. Please try again.').show();
        },
      });
    }

    fetchRepos();
  });
}

/*
    Method for linking hook with an existing repository
    Steps:
    1. Check if existing repository exists and the user has write access to it.
    2. Link Hook to it (chrome Storage).
*/
const linkRepo = (token, name) => {
  const AUTHENTICATION_URL = `https://api.github.com/repos/${name}`;

  const xhr = new XMLHttpRequest();
  xhr.addEventListener('readystatechange', function () {
    if (xhr.readyState === 4) {
      /* GitHub returns JSON for every documented status, but a proxy/offline
         failure can yield an empty or HTML body — don't let that throw. */
      let res = {};
      try {
        res = JSON.parse(xhr.responseText);
      } catch {
        res = {};
      }
      const bool = linkStatusCode(xhr.status, name);
      if (xhr.status === 200) {
        // BUG FIX
        if (!bool) {
          // unable to gain access to repo in commit mode. Must switch to hook mode.
          /* Set mode type to hook */
          chrome.storage.local.set({ mode_type: 'hook' }, () => {
            console.log(`Error linking ${name} to LeetGit`);
          });
          /* Set Repo Hook to NONE */
          chrome.storage.local.set({ leethub_hook: null }, () => {
            console.log('Defaulted repo hook to NONE');
          });

          /* Hide accordingly */
          document.getElementById('hook_mode').style.display = 'inherit';
          document.getElementById('commit_mode').style.display = 'none';
        } else {
          /* Change mode type to commit */
          /* Save repo url to chrome storage */
          chrome.storage.local.set({ mode_type: 'commit', repo: res.html_url }, () => {
            $('#error').hide();
            $('#success').html(
              `Successfully linked <a target="blank" href="${res.html_url}">${name}</a> to LeetGit. Start <a href="https://leetcode.com">LeetCoding</a> now!`,
            );
            $('#success').show();
            $('#unlink').show();
          });
          /* Set Repo Hook */
          chrome.storage.local
            .set({ leethub_hook: res.full_name })
            .then(() => {
              console.log('Successfully set new repo hook');
              return chrome.storage.local.get('stats');
            })
            .then(psolved => {
              /* Get problems solved count */
              const { stats } = psolved;
              if (stats && stats.solved) {
                $('#p_solved').text(stats.solved);
                $('#p_solved_easy').text(stats.easy);
                $('#p_solved_medium').text(stats.medium);
                $('#p_solved_hard').text(stats.hard);
              }
            });

          /* Hide accordingly */
          document.getElementById('hook_mode').style.display = 'none';
          document.getElementById('commit_mode').style.display = 'inherit';
        }
      }
    }
  });

  xhr.open('GET', AUTHENTICATION_URL, true);
  xhr.setRequestHeader('Authorization', `Bearer ${token}`);
  xhr.setRequestHeader('Accept', 'application/vnd.github.v3+json');
  xhr.send();
};

const unlinkRepo = () => {
  /* Set mode type to hook */
  chrome.storage.local.set({ mode_type: 'hook' }, () => {
    console.log(`Unlinking repo`);
  });
  /* Set Repo Hook to NONE */
  chrome.storage.local.set({ leethub_hook: null }, () => {
    console.log('Setting repo hook to NONE');
  });

  /* Hide accordingly */
  document.getElementById('hook_mode').style.display = 'inherit';
  document.getElementById('commit_mode').style.display = 'none';
};

/* Check for value of select tag, Get Started disabled by default */

$('#type').on('change', function () {
  const valueSelected = this.value;
  if (valueSelected) {
    $('#hook_button').attr('disabled', false);
  } else {
    $('#hook_button').attr('disabled', true);
  }
});

$('#hook_button').on('click', () => {
  /* on click should generate: 1) option 2) repository name */
  if (!option()) {
    $('#error').text(
      'No option selected - Pick an option from dropdown menu below that best suits you!',
    );
    $('#error').show();
  } else if (!repositoryName()) {
    $('#error').text('No repository name added - Enter the name of your repository!');
    $('#name').focus();
    $('#error').show();
  } else {
    $('#error').hide();
    $('#success').text('Attempting to create Hook... Please wait.');
    $('#success').show();

    /*
      Perform processing
      - step 1: Check if current stage === hook.
      - step 2: store repo name as repoName in chrome storage.
      - step 3: if (1), POST request to repoName (iff option = create new repo) ; else display error message.
      - step 4: if proceed from 3, hide hook_mode and display commit_mode (show stats e.g: files pushed/questions-solved/leaderboard)
    */
    chrome.storage.local.get(['leethub_token', 'leethub_username'], async data => {
      const token = data.leethub_token;
      let username = data.leethub_username;
      if (token === null || token === undefined) {
        /* Not authorized yet. */
        $('#error').text(
          'Personal Access Token error - Please enter your GitHub PAT in the extension popup to continue.',
        );
        $('#error').show();
        $('#success').hide();
      } else if (option() === 'new') {
        createRepo(token, repositoryName());
      } else {
        if (!username) {
          try {
            const userRes = await fetch('https://api.github.com/user', {
              headers: {
                Authorization: `Bearer ${token}`,
                Accept: 'application/vnd.github.v3+json',
              },
            });
            if (userRes.ok) {
              const userData = await userRes.json();
              username = userData.login;
              chrome.storage.local.set({ leethub_username: username });
            }
          } catch (e) {
            console.error('Error fetching user info:', e);
          }
        }

        const repoToLink = repositoryName().includes('/')
          ? repositoryName()
          : username
            ? `${username}/${repositoryName()}`
            : repositoryName();
        linkRepo(token, repoToLink);
      }
    });
  }
});

$('#unlink a').on('click', () => {
  unlinkRepo();
  $('#unlink').hide();
  $('#success').text('Successfully unlinked your current git repo. Please create/link a new hook.');
});

/* Add sync count behavior */
$('#sync_counts').on('click', async () => {
  //Check if linked to repo
  chrome.storage.local.get('leethub_hook', data => {
    const hook = data.leethub_hook;
    if (!hook) {
      $('#error').text('No repository linked - Please link a repository to sync counts!');
      $('#error').show();
      return;
    } else {
      $('#error').hide();
    }
  });
  //Get stats

  /* Recount the solved totals, but carry `shas` over untouched. This sync only walks
     READMEs to tally difficulties — it never rediscovers blob SHAs — so blanking the
     map here would make every already-pushed file look new, and the next submission to
     any of them would be sent to GitHub without the SHA it requires for an update. */
  const { stats: previousStats } = await chrome.storage.local.get('stats');
  const stats = {};
  stats.solved = 0;
  stats.easy = 0;
  stats.medium = 0;
  stats.hard = 0;
  stats.shas = previousStats?.shas ?? {};

  //Get problems solved count from linked repo
  const repo = await chrome.storage.local.get('leethub_hook').then(({ leethub_hook }) => {
    if (leethub_hook == null) {
      $('#error').text('No repository linked - Please link a repository to sync counts!');
      $('#error').show();
      return;
    } else {
      $('#error').hide();
    }
    return leethub_hook;
  });

  //Get token from storage
  const token = await chrome.storage.local.get('leethub_token').then(({ leethub_token }) => {
    if (leethub_token == null) {
      $('#error').text(
        'No token found - Please enter your GitHub Personal Access Token in the extension popup!',
      );
      $('#error').show();
      return;
    } else {
      $('#error').hide();
    }
    return leethub_token;
  });

  // Fetch repository data using GitHub API
  const fetchRepoData = async () => {
    const MEDIUM = 'medium';
    const HARD = 'hard';
    const EASY = 'easy';
    try {
      const response = await fetch(`https://api.github.com/repos/${repo}/contents`, {
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: 'application/vnd.github.v3+json',
        },
      });

      if (!response.ok) {
        throw new Error(`Failed to fetch repository data: ${response.statusText}`);
      }

      const repoContents = await response.json();

      const extractReadmeContent = async contents => {
        const promises = contents.map(async item => {
          try {
            if (item.name.toLowerCase() === 'readme.md') {
              const { content } = await fetchFileContent(repo, item.path, token, item.type);
              const difficulty = content.split('<h3>')[1]?.split('</h3>')[0]?.trim();
              console.debug(`Difficulty for ${item.path}: ${difficulty}`);
              if (difficulty) {
                if (difficulty.toLowerCase() === EASY) {
                  stats.easy += 1;
                } else if (difficulty.toLowerCase() === MEDIUM) {
                  stats.medium += 1;
                } else if (difficulty.toLowerCase() === HARD) {
                  stats.hard += 1;
                }
                stats.solved += 1;
              }
              return { path: item.path, difficulty };
            } else if (item.type === 'dir') {
              const { content: subContents } = await fetchFileContent(
                repo,
                item.path,
                token,
                item.type,
              );
              console.debug(`Processing subdirectory: ${item.path}`);
              // Recursively process subdirectories
              return extractReadmeContent(subContents);
            }
          } catch (error) {
            console.error(`Error processing ${item.path}: ${error.message}`);
            return null;
          }
        });

        // Wait for all promises to resolve concurrently
        return Promise.all(promises);
      };

      await extractReadmeContent(repoContents);

      // Update the stats in local storage
      chrome.storage.local.set({ stats }, () => {
        $('#p_solved').text(stats.solved);
        $('#p_solved_easy').text(stats.easy);
        $('#p_solved_medium').text(stats.medium);
        $('#p_solved_hard').text(stats.hard);
      });
    } catch (error) {
      console.error(error.message);
      $('#error').text('Failed to fetch repository data. Please try again.').show();
    }
  };

  fetchRepoData();
});

const fetchFileContent = async (repo, path, token, itemType) => {
  try {
    const response = await fetch(`https://api.github.com/repos/${repo}/contents/${path}`, {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/vnd.github.v3+json',
      },
    });

    if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);

    const data = await response.json();
    // Content is Base64 encoded
    return {
      content: itemType !== 'dir' ? atob(data.content) /* Decode base64*/ : data,
      sha: data.sha,
    };
  } catch (error) {
    console.error(`Failed to fetch file content: ${error.message}`);
    throw error;
  }
};

/* Detect mode type */
chrome.storage.local.get('mode_type', data => {
  const mode = data.mode_type;

  if (mode && mode === 'commit') {
    /* Check if still access to repo */
    chrome.storage.local.get('leethub_token', data2 => {
      const token = data2.leethub_token;
      if (token === null || token === undefined) {
        /* Not authorized yet. */
        $('#error').text(
          'Personal Access Token error - Please enter your GitHub PAT in the extension popup to continue.',
        );
        $('#error').show();
        $('#success').hide();
        /* Hide accordingly */
        document.getElementById('hook_mode').style.display = 'inherit';
        document.getElementById('commit_mode').style.display = 'none';
      } else {
        /* Get access to repo */
        chrome.storage.local.get('leethub_hook', repoName => {
          const hook = repoName.leethub_hook;
          if (!hook) {
            /* Not authorized yet. */
            $('#error').text(
              'No repository hook found - Please link or create a repository below.',
            );
            $('#error').show();
            $('#success').hide();
            /* Hide accordingly */
            document.getElementById('hook_mode').style.display = 'inherit';
            document.getElementById('commit_mode').style.display = 'none';
          } else {
            /* Hook exists, link and verify */
            linkRepo(token, hook);
          }
        });
      }
    });

    document.getElementById('hook_mode').style.display = 'none';
    document.getElementById('commit_mode').style.display = 'inherit';
  } else {
    document.getElementById('hook_mode').style.display = 'inherit';
    document.getElementById('commit_mode').style.display = 'none';
  }
});
