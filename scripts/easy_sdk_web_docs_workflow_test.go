package scripts_test

import (
	"strings"
	"testing"

	"github.com/stretchr/testify/require"
	"go.yaml.in/yaml/v3"
)

func TestEasySDKWebDocsWorkflowSeparatesVerificationAndPRWriting(t *testing.T) {
	raw := readWorkflow(t, "easy-sdk-web-docs-sync.yml")
	var workflow struct {
		On          map[string]any    `yaml:"on"`
		Permissions map[string]string `yaml:"permissions"`
		Jobs        map[string]struct {
			If          string            `yaml:"if"`
			Needs       any               `yaml:"needs"`
			Permissions map[string]string `yaml:"permissions"`
			Timeout     int               `yaml:"timeout-minutes"`
			Steps       []struct {
				Run  string         `yaml:"run"`
				Uses string         `yaml:"uses"`
				With map[string]any `yaml:"with"`
			} `yaml:"steps"`
		} `yaml:"jobs"`
	}
	require.NoError(t, yaml.Unmarshal(raw, &workflow))
	require.Equal(t, map[string]string{"contents": "read"}, workflow.Permissions)
	require.Contains(t, workflow.On, "schedule")
	require.Contains(t, workflow.On, "workflow_dispatch")
	require.NotContains(t, workflow.On, "pull_request_target")
	require.Len(t, workflow.Jobs, 3)
	for name, job := range workflow.Jobs {
		require.Positive(t, job.Timeout)
		require.LessOrEqual(t, job.Timeout, 25)
		for _, step := range job.Steps {
			if strings.HasPrefix(step.Uses, "actions/checkout@") {
				require.Equal(t, false, step.With["persist-credentials"])
			}
		}
		if name != "propose" {
			require.Empty(t, job.Permissions)
			continue
		}
		require.Equal(t, map[string]string{"contents": "write", "pull-requests": "write"}, job.Permissions)
		require.Contains(t, job.If, "github.ref == 'refs/heads/main'")
		require.Contains(t, job.If, "github.repository == 'WuKongIM/WuKongIM'")
		require.Contains(t, job.If, "needs.discover.outputs.decision == 'upgrade'")
		require.Contains(t, job.If, "github.event_name == 'schedule' || github.event_name == 'workflow_dispatch'")
		require.Equal(t, []any{"discover", "verify"}, job.Needs)
		for _, step := range job.Steps {
			require.NotContains(t, step.Run, "npm")
			require.NotContains(t, step.Run, "go test")
			require.NotContains(t, step.Run, "git push")
		}
	}
	text := string(raw)
	require.NotContains(t, text, "secrets.")
	require.Contains(t, text, "--ignore-scripts")
	require.Contains(t, text, "./test/e2e/message/easy_sdk_docs_release")
	require.Contains(t, text, "bun run verify")
	require.Contains(t, text, "easy-sdk-plan/receipt.json")
	require.NotContains(t, text, "server.log")
}
