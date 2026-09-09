//go:build e2e

package easy_sdk_docs_release_test

import (
	"context"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"testing"
	"time"

	"github.com/WuKongIM/WuKongIM/test/e2e/suite"
	"github.com/stretchr/testify/require"
)

func TestReleasedWebTutorialInChromium(t *testing.T) {
	artifacts := os.Getenv("WK_E2E_EASYSDK_ARTIFACTS")
	if artifacts == "" {
		t.Skip("set WK_E2E_EASYSDK_ARTIFACTS after preparing the exact npm consumer")
	}
	artifacts, err := filepath.Abs(artifacts)
	require.NoError(t, err)
	cluster := suite.New(t).StartStaticCluster(1, suite.WithWebSocketGateway(),
		suite.WithNodeConfigOverrides(1, map[string]string{
			"WK_CLUSTER_HASH_SLOT_COUNT": "256", "WK_GATEWAY_TOKEN_AUTH_ON": "true",
		}))
	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
	defer cancel()
	require.NoError(t, cluster.WaitHTTPReady(ctx))
	node := cluster.MustNode(1)
	_, filename, _, ok := runtime.Caller(0)
	require.True(t, ok)
	browserCtx, stop := context.WithTimeout(context.Background(), 90*time.Second)
	defer stop()
	cmd := exec.CommandContext(browserCtx, "node", filepath.Join(filepath.Dir(filename), "smoke.mjs"))
	// The browser runner inherits only runtime paths and synthetic harness inputs.
	for _, key := range []string{"PATH", "HOME", "TMPDIR", "PLAYWRIGHT_BROWSERS_PATH", "GITHUB_RUN_ID"} {
		if value := os.Getenv(key); value != "" {
			cmd.Env = append(cmd.Env, key+"="+value)
		}
	}
	cmd.Env = append(cmd.Env, "WK_ARTIFACT_DIRECTORY="+artifacts, "WK_API_URL=http://"+node.APIAddr(), "WK_WS_URL="+node.WebSocketURL())
	cmd.Stdout, cmd.Stderr = os.Stdout, os.Stderr
	cmd.WaitDelay = 5 * time.Second
	suite.PrepareCommandProcessTree(cmd)
	defer func() {
		if cmd.Process != nil {
			require.NoError(t, suite.ReapCommandProcessTree(cmd.Process, 5*time.Second))
		}
	}()
	require.NoError(t, cmd.Run(), "released Web tutorial acceptance failed")
}
