/**
 * GitHub REST API를 사용한 파일 동기화
 *
 * Railway Docker 컨테이너에는 git이 설치되어 있지 않으므로
 * GitHub Contents API를 통해 파일을 직접 업데이트한다.
 *
 * 필요 환경변수:
 *   GITHUB_TOKEN  – contents:write 권한의 Personal Access Token (Fine-grained 또는 Classic)
 *   GITHUB_REPO   – "owner/repo" 형식 (예: "username/Web-Scraper-Final")
 *   GITHUB_BRANCH – 대상 브랜치 (기본: "main")
 */

const GITHUB_API = "https://api.github.com";

function getConfig() {
  const token = process.env.GITHUB_TOKEN;
  const repo = process.env.GITHUB_REPO;
  const branch = process.env.GITHUB_BRANCH || "main";
  return { token, repo, branch };
}

export function isGitHubApiAvailable(): boolean {
  const { token, repo } = getConfig();
  return !!(token && repo);
}

interface GitHubFileInfo {
  sha: string;
  content: string;
}

async function getFileSha(filePath: string): Promise<string | null> {
  const { token, repo, branch } = getConfig();
  if (!token || !repo) return null;

  const url = `${GITHUB_API}/repos/${repo}/contents/${encodeURIComponent(filePath)}?ref=${branch}`;
  try {
    const res = await fetch(url, {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/vnd.github.v3+json",
        "X-GitHub-Api-Version": "2022-11-28",
      },
    });
    if (!res.ok) return null;
    const data = (await res.json()) as GitHubFileInfo;
    return data.sha;
  } catch {
    return null;
  }
}

export interface GitHubSyncResult {
  success: boolean;
  message: string;
  details?: string;
}

/**
 * 단일 파일을 GitHub에 업데이트 (커밋)
 */
export async function updateFileOnGitHub(
  filePath: string,
  content: string,
  commitMessage: string
): Promise<GitHubSyncResult> {
  const { token, repo, branch } = getConfig();

  if (!token || !repo) {
    return {
      success: false,
      message: "GITHUB_TOKEN 또는 GITHUB_REPO 환경변수 미설정",
    };
  }

  try {
    const sha = await getFileSha(filePath);

    const body: Record<string, unknown> = {
      message: commitMessage,
      content: Buffer.from(content, "utf-8").toString("base64"),
      branch,
    };
    if (sha) {
      body.sha = sha;
    }

    const url = `${GITHUB_API}/repos/${repo}/contents/${encodeURIComponent(filePath)}`;
    const res = await fetch(url, {
      method: "PUT",
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/vnd.github.v3+json",
        "Content-Type": "application/json",
        "X-GitHub-Api-Version": "2022-11-28",
      },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      const msg = (err as Record<string, unknown>).message || res.statusText;
      return { success: false, message: `GitHub API 오류: ${msg}` };
    }

    return { success: true, message: "GitHub 동기화 완료", details: filePath };
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : String(error);
    return { success: false, message: "GitHub 동기화 실패", details: msg };
  }
}

/**
 * 여러 파일을 한 번의 커밋으로 업데이트 (Git Tree API 사용)
 */
export async function updateMultipleFilesOnGitHub(
  files: { path: string; content: string }[],
  commitMessage: string
): Promise<GitHubSyncResult> {
  const { token, repo, branch } = getConfig();

  if (!token || !repo) {
    return {
      success: false,
      message: "GITHUB_TOKEN 또는 GITHUB_REPO 환경변수 미설정",
    };
  }

  try {
    const headers = {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github.v3+json",
      "Content-Type": "application/json",
      "X-GitHub-Api-Version": "2022-11-28",
    };

    // 1. 현재 브랜치의 최신 커밋 SHA 가져오기
    const refRes = await fetch(
      `${GITHUB_API}/repos/${repo}/git/ref/heads/${branch}`,
      { headers }
    );
    if (!refRes.ok) throw new Error(`브랜치 정보 조회 실패: ${refRes.statusText}`);
    const refData = (await refRes.json()) as { object: { sha: string } };
    const latestCommitSha = refData.object.sha;

    // 2. 최신 커밋의 트리 SHA 가져오기
    const commitRes = await fetch(
      `${GITHUB_API}/repos/${repo}/git/commits/${latestCommitSha}`,
      { headers }
    );
    if (!commitRes.ok) throw new Error(`커밋 정보 조회 실패: ${commitRes.statusText}`);
    const commitData = (await commitRes.json()) as { tree: { sha: string } };
    const baseTreeSha = commitData.tree.sha;

    // 3. 새 블롭 생성 (각 파일마다)
    const treeItems: { path: string; mode: string; type: string; sha: string }[] = [];
    for (const file of files) {
      const blobRes = await fetch(`${GITHUB_API}/repos/${repo}/git/blobs`, {
        method: "POST",
        headers,
        body: JSON.stringify({
          content: file.content,
          encoding: "utf-8",
        }),
      });
      if (!blobRes.ok) throw new Error(`블롭 생성 실패: ${file.path}`);
      const blobData = (await blobRes.json()) as { sha: string };
      treeItems.push({
        path: file.path,
        mode: "100644",
        type: "blob",
        sha: blobData.sha,
      });
    }

    // 4. 새 트리 생성
    const treeRes = await fetch(`${GITHUB_API}/repos/${repo}/git/trees`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        base_tree: baseTreeSha,
        tree: treeItems,
      }),
    });
    if (!treeRes.ok) throw new Error(`트리 생성 실패: ${treeRes.statusText}`);
    const treeData = (await treeRes.json()) as { sha: string };

    // 5. 새 커밋 생성
    const newCommitRes = await fetch(`${GITHUB_API}/repos/${repo}/git/commits`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        message: commitMessage,
        tree: treeData.sha,
        parents: [latestCommitSha],
      }),
    });
    if (!newCommitRes.ok) throw new Error(`커밋 생성 실패: ${newCommitRes.statusText}`);
    const newCommitData = (await newCommitRes.json()) as { sha: string };

    // 6. 브랜치 ref 업데이트
    const updateRefRes = await fetch(
      `${GITHUB_API}/repos/${repo}/git/refs/heads/${branch}`,
      {
        method: "PATCH",
        headers,
        body: JSON.stringify({ sha: newCommitData.sha }),
      }
    );
    if (!updateRefRes.ok) throw new Error(`브랜치 업데이트 실패: ${updateRefRes.statusText}`);

    return {
      success: true,
      message: "GitHub 동기화 완료",
      details: `${files.length}개 파일 커밋`,
    };
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : String(error);
    return { success: false, message: "GitHub 동기화 실패", details: msg };
  }
}
