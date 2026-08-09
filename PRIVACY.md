# Privacy Policy — amzinvite

**Dernière mise à jour :** 2026-08-02

amzinvite est conçu pour fonctionner avec un minimum de données.

## Données stockées localement

Les informations suivantes restent dans le navigateur :

- `instanceId` : identifiant anonyme généré localement
- des credentials d'authentification aléatoires : un lié à l'instance et un
  credential court distinct pour les observations anonymes
- `intervalMin`, `autoRequest`, `communityDataEnabled`, `trackPokemonTcgFr` : préférences de l'extension
- `customUrls` : liens Amazon ajoutés manuellement
- `knownStates` : états détectés pour les produits suivis
- `publicFeed`, `lastRun`, `checkProgress`, `autoSpawnLog` : données internes de fonctionnement

Un reset complet est disponible depuis le popup.

## Données envoyées au service amzinvite

### Feed public

L'extension récupère la liste publique des produits en mode invitation.

### Partage anonyme

Quand l'option de partage anonyme est activée, l'extension peut envoyer :

- des détections d'état d'invitation
- les prix et disponibilités détectés sur les pages Amazon que l'utilisateur
  consulte volontairement

L'extension ne reçoit aucun produit supplémentaire à contrôler pour PrixTCG et
n'analyse que les pages Amazon effectivement consultées par l'utilisateur.

Ces envois sont conçus pour améliorer la qualité du service. Ils n'incluent pas de nom, d'email ou d'informations de paiement.

## Suivi automatique

Par défaut, amzinvite suit automatiquement les produits POKÉMON TCG FR via le feed public. Tu peux :

1. désactiver ce suivi à tout moment
2. ajouter des liens Amazon FR manuellement (conservés même si le feed est désactivé)
3. conserver un intervalle automatique d'au moins 30 minutes

## Données envoyées à Amazon

Si l'option **Auto-demander** est activée, l'extension peut envoyer la demande d'invitation directement à Amazon France ou Belgique en utilisant la session déjà ouverte dans le navigateur.

## Contrôle utilisateur

Tu peux à tout moment :

1. désactiver le partage anonyme
2. désactiver l'auto-demande
3. supprimer les données locales via le bouton Reset
4. désinstaller l'extension

## Contact

Pour toute question liée à la confidentialité, utilise le dépôt GitHub officiel du projet.
