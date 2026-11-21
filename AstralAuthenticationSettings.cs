namespace AstralAuthentication
{
    using UnityEngine;

    [CreateAssetMenu(menuName = "Astral/Authentication Settings", fileName = "AstralAuthenticationSettings")]
    public sealed class AstralAuthenticationSettings : ScriptableObject
    {
        [Header("Astral")]
        [Tooltip("Game ID created in the Astral developer dashboard. Not a secret.")]
        public string GameId;
        [Tooltip("Your deployed Astral API base URL, e.g. https://astral.example.com")]
        public string ApiBaseUrl;

        [Header("Local detection")]
        public bool CheckMelonLoaderFolder = true;
        public bool CheckLemonLoaderFolder = true;
    }
}
