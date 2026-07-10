# Greengrass V2 nucleus config template (manual provisioning, PROVISION=false).
# Copy to gg-config/config.yaml and fill the <...> placeholders from the
# Secrets Manager bundle joppilot-dev-greengrass-core-VEH-001 (README step 2 —
# every value is in the bundle). Cert files live in gg-certs/ (mounted at
# /tmp/certs inside the container).
system:
  certificateFilePath: "/tmp/certs/device.pem.crt"
  privateKeyPath: "/tmp/certs/private.pem.key"
  rootCaPath: "/tmp/certs/AmazonRootCA1.pem"
  rootpath: "/greengrass/v2"
  thingName: "<thingName>"
services:
  aws.greengrass.Nucleus:
    componentType: "NUCLEUS"
    configuration:
      awsRegion: "eu-central-1"
      iotRoleAlias: "<roleAlias>"
      iotDataEndpoint: "<iotDataEndpoint>"
      iotCredEndpoint: "<iotCredEndpoint>"
