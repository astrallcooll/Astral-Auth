namespace AstralAuthentication
{
    using System.Collections;
    using Photon.Pun;
    using UnityEngine;

    /// <summary>
    /// Example orchestration. Call BeginConnect after PlayFab login has supplied
    /// a valid SessionTicket. Keep your PlayFab title secret out of this client.
    /// </summary>
    public sealed class AstralPun2ConnectExample : MonoBehaviour
    {
        [SerializeField] private AstralAuthenticationClient astral;
        [SerializeField] private AstralPun2Authenticator photonAuth;

        public void BeginConnect(string playFabSessionTicket)
        {
            StartCoroutine(AuthenticateThenConnect(playFabSessionTicket));
        }

        private IEnumerator AuthenticateThenConnect(string ticket)
        {
            bool finished = false;
            AstralIssueResponse response = null;
            yield return astral.Authenticate(ticket, r => { response = r; finished = true; });
            while (!finished) yield return null;

            if (response == null || !response.ok)
            {
                Debug.LogError("Astral authentication failed: " + (response?.error ?? "Unknown error"));
                yield break;
            }

            PhotonNetwork.AuthValues = photonAuth.CreatePhotonAuthenticationValues();
            PhotonNetwork.ConnectUsingSettings();
        }
    }
}
