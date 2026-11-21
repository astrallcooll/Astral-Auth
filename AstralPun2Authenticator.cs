namespace AstralAuthentication
{
    using System;
    using Photon.Realtime;
    using UnityEngine;

    /// <summary>
    /// Assign this component after PlayFab login and Astral authentication.
    /// Configure the Photon Dashboard Custom Authentication URL to:
    /// https://YOUR-ASTRAL-HOST/photon/authenticate
    /// Add a custom auth parameter named "token".
    /// </summary>
    public sealed class AstralPun2Authenticator : MonoBehaviour
    {
        [SerializeField] private AstralAuthenticationClient astral;

        public AuthenticationValues CreatePhotonAuthenticationValues()
        {
            if (astral == null || !astral.IsAuthenticated ||
                string.IsNullOrEmpty(astral.AuthenticationToken))
                throw new InvalidOperationException("Astral authentication must succeed before connecting to Photon.");

            var values = new AuthenticationValues(astral.PlayFabId);
            values.AuthType = CustomAuthenticationType.Custom;
            values.AddAuthParameter("token", astral.AuthenticationToken);
            return values;
        }
    }
}
