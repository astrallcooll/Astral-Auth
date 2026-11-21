namespace AstralAuthentication
{
    using System;
    using System.Collections;
    using System.IO;
    using UnityEngine;
    using UnityEngine.Networking;

    [Serializable] public sealed class AstralLocalChecks
    {
        public bool melonLoader;
        public bool lemonLoader;
    }

    [Serializable] public sealed class AstralIssueRequest
    {
        public string gameId;
        public string playFabSessionTicket;
        public AstralLocalChecks localChecks;
    }

    [Serializable] public sealed class AstralIssueResponse
    {
        public bool ok;
        public string token;
        public string astralId;
        public string playFabId;
        public string verdict;
        public string error;
    }

    public sealed class AstralAuthenticationClient : MonoBehaviour
    {
        [SerializeField] private AstralAuthenticationSettings settings;
        public bool IsAuthenticated { get; private set; }
        public string AstralId { get; private set; }
        public string PlayFabId { get; private set; }
        public string AuthenticationToken { get; private set; }
        public string LastError { get; private set; }

        public IEnumerator Authenticate(string playFabSessionTicket, Action<AstralIssueResponse> completed)
        {
            IsAuthenticated = false;
            LastError = null;

            if (settings == null || string.IsNullOrWhiteSpace(settings.GameId) ||
                string.IsNullOrWhiteSpace(settings.ApiBaseUrl))
            {
                LastError = "Astral settings are missing.";
                completed?.Invoke(new AstralIssueResponse { error = LastError });
                yield break;
            }

            var checks = RunLocalChecks();
            if (checks.melonLoader || checks.lemonLoader)
            {
                LastError = "ASTRAL-001: prohibited loader folder detected.";
                completed?.Invoke(new AstralIssueResponse { error = LastError });
                yield break;
            }

            var payload = new AstralIssueRequest {
                gameId = settings.GameId,
                playFabSessionTicket = playFabSessionTicket,
                localChecks = checks
            };
            var bytes = System.Text.Encoding.UTF8.GetBytes(JsonUtility.ToJson(payload));
            using (var request = new UnityWebRequest(settings.ApiBaseUrl.TrimEnd('/') + "/v1/auth/issue", "POST"))
            {
                request.uploadHandler = new UploadHandlerRaw(bytes);
                request.downloadHandler = new DownloadHandlerBuffer();
                request.SetRequestHeader("Content-Type", "application/json");
                yield return request.SendWebRequest();

                AstralIssueResponse result = null;
                try { result = JsonUtility.FromJson<AstralIssueResponse>(request.downloadHandler.text); }
                catch { result = new AstralIssueResponse { error = "Invalid Astral response." }; }

                if (request.result != UnityWebRequest.Result.Success || result == null || !result.ok ||
                    string.IsNullOrEmpty(result.token))
                {
                    LastError = result != null && !string.IsNullOrEmpty(result.error) ? result.error : request.error;
                    completed?.Invoke(result ?? new AstralIssueResponse { error = LastError });
                    yield break;
                }

                AuthenticationToken = result.token;
                AstralId = result.astralId;
                PlayFabId = result.playFabId;
                IsAuthenticated = true;
                completed?.Invoke(result);
            }
        }

        private AstralLocalChecks RunLocalChecks()
        {
            var root = Application.persistentDataPath;
            return new AstralLocalChecks {
                melonLoader = settings.CheckMelonLoaderFolder &&
                    Directory.Exists(Path.Combine(root, "MelonLoader")),
                lemonLoader = settings.CheckLemonLoaderFolder &&
                    Directory.Exists(Path.Combine(root, "lemonloader"))
            };
        }
    }
}
