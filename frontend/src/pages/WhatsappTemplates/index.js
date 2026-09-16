import React, { useEffect, useState } from "react";

import { makeStyles } from "@material-ui/core/styles";
import {
  Paper,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  FormControl,
  InputLabel,
  Select,
  MenuItem,
  Button,
  Chip,
  Typography,
  CircularProgress,
  Grid
} from "@material-ui/core";

import MainContainer from "../../components/MainContainer";
import MainHeader from "../../components/MainHeader";
import Title from "../../components/Title";
import TableRowSkeleton from "../../components/TableRowSkeleton";
import CampaignModal from "../../components/CampaignModal";

import api from "../../services/api";
import { i18n } from "../../translate/i18n";
import toastError from "../../errors/toastError";

const useStyles = makeStyles(theme => ({
  mainPaper: {
    flex: 1,
    padding: theme.spacing(2),
    overflowY: "scroll",
    ...theme.scrollbarStyles
  },
  selectPaper: {
    padding: theme.spacing(2),
    marginBottom: theme.spacing(2)
  },
  bodyPreview: {
    whiteSpace: "pre-wrap",
    fontSize: 12,
    color: theme.palette.text.secondary,
    maxWidth: 380
  }
}));

const statusColor = status => {
  const s = (status || "").toUpperCase();
  if (s === "APPROVED") return "primary";
  if (s === "REJECTED") return "secondary";
  return "default";
};

const WhatsappTemplates = () => {
  const classes = useStyles();

  const [connections, setConnections] = useState([]);
  const [selectedWhatsappId, setSelectedWhatsappId] = useState("");
  const [templates, setTemplates] = useState([]);
  const [loading, setLoading] = useState(false);

  const [campaignModalOpen, setCampaignModalOpen] = useState(false);
  const [campaignInitialValues, setCampaignInitialValues] = useState(null);

  useEffect(() => {
    const fetchConnections = async () => {
      try {
        const { data } = await api.get("/whatsapp", {
          params: { session: 0 }
        });
        const official = (data || []).filter(
          w => w.channel === "whatsapp_oficial"
        );
        setConnections(official);
        if (official.length === 1) {
          setSelectedWhatsappId(official[0].id);
        }
      } catch (err) {
        toastError(err);
      }
    };
    fetchConnections();
  }, []);

  useEffect(() => {
    let active = true;
    if (!selectedWhatsappId) {
      setTemplates([]);
      return undefined;
    }
    setLoading(true);
    api
      .get(`/wa-api/${selectedWhatsappId}/templates`)
      .then(({ data }) => {
        if (active) setTemplates(Array.isArray(data) ? data : []);
      })
      .catch(err => {
        if (active) {
          setTemplates([]);
          toastError(err);
        }
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [selectedWhatsappId]);

  const handleCreateCampaign = template => {
    setCampaignInitialValues({
      whatsappId: selectedWhatsappId,
      templateName: template.name,
      templateLanguage: template.language,
      templateParams: []
    });
    setCampaignModalOpen(true);
  };

  const handleCloseCampaignModal = () => {
    setCampaignModalOpen(false);
    setCampaignInitialValues(null);
  };

  return (
    <MainContainer>
      <CampaignModal
        open={campaignModalOpen}
        onClose={handleCloseCampaignModal}
        campaignId={null}
        initialValues={campaignInitialValues}
        resetPagination={() => {}}
      />
      <MainHeader>
        <Title>{i18n.t("whatsappTemplates.title")}</Title>
      </MainHeader>

      <Paper className={classes.selectPaper} variant="outlined">
        {connections.length === 0 ? (
          <Typography color="textSecondary">
            {i18n.t("whatsappTemplates.noOfficialConnections")}
          </Typography>
        ) : (
          <Grid container spacing={2} alignItems="center">
            <Grid item xs={12} md={6}>
              <FormControl variant="outlined" margin="dense" fullWidth>
                <InputLabel id="wa-connection-label">
                  {i18n.t("whatsappTemplates.connection")}
                </InputLabel>
                <Select
                  labelId="wa-connection-label"
                  label={i18n.t("whatsappTemplates.connection")}
                  value={selectedWhatsappId}
                  onChange={e => setSelectedWhatsappId(e.target.value)}
                >
                  <MenuItem value="">
                    {i18n.t("whatsappTemplates.selectConnection")}
                  </MenuItem>
                  {connections.map(conn => (
                    <MenuItem key={conn.id} value={conn.id}>
                      {conn.name}
                    </MenuItem>
                  ))}
                </Select>
              </FormControl>
            </Grid>
          </Grid>
        )}
      </Paper>

      <Paper className={classes.mainPaper} variant="outlined">
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell>{i18n.t("whatsappTemplates.table.name")}</TableCell>
              <TableCell align="center">
                {i18n.t("whatsappTemplates.table.language")}
              </TableCell>
              <TableCell align="center">
                {i18n.t("whatsappTemplates.table.category")}
              </TableCell>
              <TableCell align="center">
                {i18n.t("whatsappTemplates.table.status")}
              </TableCell>
              <TableCell>{i18n.t("whatsappTemplates.table.body")}</TableCell>
              <TableCell align="center">
                {i18n.t("whatsappTemplates.table.variables")}
              </TableCell>
              <TableCell align="center">
                {i18n.t("whatsappTemplates.table.actions")}
              </TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {loading ? (
              <TableRowSkeleton columns={7} />
            ) : templates.length === 0 ? (
              <TableRow>
                <TableCell colSpan={7} align="center">
                  <Typography color="textSecondary">
                    {selectedWhatsappId
                      ? i18n.t("whatsappTemplates.empty")
                      : i18n.t("whatsappTemplates.selectConnectionHint")}
                  </Typography>
                </TableCell>
              </TableRow>
            ) : (
              templates.map(t => {
                const isApproved =
                  (t.status || "").toUpperCase() === "APPROVED";
                return (
                  <TableRow key={`${t.name}|||${t.language}`}>
                    <TableCell>{t.name}</TableCell>
                    <TableCell align="center">{t.language}</TableCell>
                    <TableCell align="center">{t.category}</TableCell>
                    <TableCell align="center">
                      <Chip
                        size="small"
                        color={statusColor(t.status)}
                        label={t.status}
                      />
                    </TableCell>
                    <TableCell>
                      <div className={classes.bodyPreview}>{t.bodyText}</div>
                    </TableCell>
                    <TableCell align="center">{t.variablesCount}</TableCell>
                    <TableCell align="center">
                      <Button
                        size="small"
                        variant="outlined"
                        color="primary"
                        disabled={!isApproved}
                        onClick={() => handleCreateCampaign(t)}
                      >
                        {i18n.t("whatsappTemplates.createCampaign")}
                      </Button>
                    </TableCell>
                  </TableRow>
                );
              })
            )}
          </TableBody>
        </Table>
      </Paper>
    </MainContainer>
  );
};

export default WhatsappTemplates;
