import React, { useState, useEffect } from "react";
import * as Yup from "yup";
import { Formik, Form, Field } from "formik";
import { toast } from "react-toastify";

import { makeStyles } from "@material-ui/core/styles";
import { green } from "@material-ui/core/colors";

import {
  Dialog,
  DialogContent,
  DialogTitle,
  Button,
  DialogActions,
  CircularProgress,
  TextField,
  Switch,
  FormControlLabel,
  FormControl,
  FormGroup,
  Typography,
  Tooltip,
  Paper,
  Grid,
  Checkbox,
  MenuItem
} from "@material-ui/core";

import api from "../../services/api";
import { getBackendURL } from "../../services/config";
import { i18n } from "../../translate/i18n";
import toastError from "../../errors/toastError";
import QueueSelect from "../QueueSelect";
import HelpOutlineOutlinedIcon from "@material-ui/icons/HelpOutlineOutlined";
import { copyToClipboard } from "../../helpers/copyToClipboard";

import { SelectLanguage } from "../SelectLanguage";

const useStyles = makeStyles(theme => ({
  root: {
    display: "flex",
    flexWrap: "wrap"
  },

  multFieldLine: {
    display: "flex",
    "& > *:not(:last-child)": {
      marginRight: theme.spacing(1)
    }
  },

  btnWrapper: {
    position: "relative"
  },

  buttonProgress: {
    color: green[500],
    position: "absolute",
    top: "50%",
    left: "50%",
    marginTop: -12,
    marginLeft: -12
  }
}));

const SessionSchema = Yup.object().shape({
  name: Yup.string()
    .min(2, "Too Short!")
    .max(50, "Too Long!")
    .required("Required")
});

const WhatsAppModal = ({ open, onClose, whatsAppId }) => {
  const classes = useStyles();
  const initialState = {
    name: "",
    greetingMessage: "",
    complationMessage: "",
    outOfHoursMessage: "",
    ratingMessage: "",
    transferMessage: "",
    isDefault: false,
    token: "",
    provider: "beta",
    language: localStorage.getItem("language") || "",
    // Canal da conexão: "whatsapp" (não oficial / Baileys / QR Code)
    // ou "whatsapp_oficial" (API oficial da Meta via EvoHub).
    channel: "whatsapp",
    evohubBaseUrl: "https://api.evohub.ai/meta",
    evohubToken: "",
    evohubPhoneNumberId: "",
    evohubWabaId: ""
  };
  const [whatsApp, setWhatsApp] = useState(initialState);
  const [selectedQueueIds, setSelectedQueueIds] = useState([]);

  useEffect(() => {
    const fetchSession = async () => {
      if (!whatsAppId) return;

      try {
        const { data } = await api.get(`whatsapp/${whatsAppId}?session=0`);
        setWhatsApp(prev => ({
          ...prev,
          ...data,
          channel: data.channel || "whatsapp",
          evohubBaseUrl: data.evohubBaseUrl || "https://api.evohub.ai/meta",
          evohubToken: data.evohubToken || "",
          evohubPhoneNumberId: data.evohubPhoneNumberId || "",
          evohubWabaId: data.evohubWabaId || ""
        }));

        const whatsQueueIds = data.queues?.map(queue => queue.id);
        setSelectedQueueIds(whatsQueueIds);
      } catch (err) {
        toastError(err);
      }
    };
    fetchSession();
  }, [whatsAppId]);

  const handleSaveWhatsApp = async values => {
    const whatsappData = { ...values, queueIds: selectedQueueIds };
    delete whatsappData["queues"];
    delete whatsappData["session"];

    try {
      if (whatsAppId) {
        await api.put(`/whatsapp/${whatsAppId}`, whatsappData);
      } else {
        await api.post("/whatsapp", whatsappData);
      }
      toast.success(i18n.t("whatsappModal.success"));
      handleClose();
    } catch (err) {
      toastError(err);
    }
  };

  const handleClose = () => {
    onClose();
    setWhatsApp(initialState);
  };

  return (
    <div className={classes.root}>
      <Dialog
        open={open}
        onClose={handleClose}
        maxWidth="sm"
        fullWidth
        scroll="paper"
      >
        <DialogTitle>
          {whatsAppId
            ? i18n.t("whatsappModal.title.edit")
            : i18n.t("whatsappModal.title.add")}
        </DialogTitle>
        <Formik
          initialValues={whatsApp}
          enableReinitialize={true}
          validationSchema={SessionSchema}
          onSubmit={(values, actions) => {
            setTimeout(() => {
              handleSaveWhatsApp(values);
              actions.setSubmitting(false);
            }, 400);
          }}
        >
          {({ values, touched, errors, isSubmitting }) => (
            <Form>
              <DialogContent dividers>
                <div className={classes.multFieldLine}>
                  <Grid spacing={2} container>
                    <Grid item>
                      <Field
                        as={TextField}
                        label={i18n.t("whatsappModal.form.name")}
                        autoFocus
                        name="name"
                        error={touched.name && Boolean(errors.name)}
                        helperText={touched.name && errors.name}
                        variant="outlined"
                        margin="dense"
                        className={classes.textField}
                      />
                    </Grid>
                    <Grid style={{ paddingTop: 15 }} item>
                      <FormControlLabel
                        control={
                          <Field
                            as={Switch}
                            color="primary"
                            name="isDefault"
                            checked={values.isDefault}
                          />
                        }
                        label={i18n.t("whatsappModal.form.default")}
                      />
                    </Grid>
                  </Grid>
                </div>
                <div>
                  <Field
                    as={TextField}
                    select
                    label={i18n.t("whatsappModal.form.channel")}
                    name="channel"
                    fullWidth
                    variant="outlined"
                    margin="dense"
                    disabled={!!whatsAppId}
                    helperText={
                      whatsAppId
                        ? i18n.t("whatsappModal.form.channelLockedHelper")
                        : i18n.t("whatsappModal.form.channelHelper")
                    }
                  >
                    <MenuItem value="whatsapp">
                      {i18n.t("whatsappModal.form.channelBaileys")}
                    </MenuItem>
                    <MenuItem value="whatsapp_oficial">
                      {i18n.t("whatsappModal.form.channelOfficial")}
                    </MenuItem>
                  </Field>
                </div>
                {values.channel === "whatsapp_oficial" && (
                  <Paper
                    variant="outlined"
                    style={{
                      padding: 12,
                      marginTop: 8,
                      marginBottom: 4
                    }}
                  >
                    <Typography variant="subtitle2" gutterBottom>
                      {i18n.t("whatsappModal.form.evohubSection")}
                    </Typography>
                    <div>
                      <Field
                        as={TextField}
                        label={i18n.t("whatsappModal.form.evohubBaseUrl")}
                        name="evohubBaseUrl"
                        fullWidth
                        variant="outlined"
                        margin="dense"
                      />
                    </div>
                    <div>
                      <Field
                        as={TextField}
                        label={i18n.t("whatsappModal.form.evohubToken")}
                        name="evohubToken"
                        type="password"
                        autoComplete="new-password"
                        fullWidth
                        variant="outlined"
                        margin="dense"
                        helperText={i18n.t(
                          "whatsappModal.form.evohubTokenHelper"
                        )}
                      />
                    </div>
                    <div>
                      <Field
                        as={TextField}
                        label={i18n.t(
                          "whatsappModal.form.evohubPhoneNumberId"
                        )}
                        name="evohubPhoneNumberId"
                        fullWidth
                        variant="outlined"
                        margin="dense"
                      />
                    </div>
                    <div>
                      <Field
                        as={TextField}
                        label={i18n.t("whatsappModal.form.evohubWabaId")}
                        name="evohubWabaId"
                        fullWidth
                        variant="outlined"
                        margin="dense"
                      />
                    </div>
                    {whatsAppId && (
                      <div style={{ marginTop: 8 }}>
                        <Typography
                          variant="caption"
                          display="block"
                          gutterBottom
                        >
                          {i18n.t("whatsappModal.form.evohubWebhookLabel")}
                        </Typography>
                        <div
                          style={{
                            display: "flex",
                            alignItems: "center",
                            gap: 8
                          }}
                        >
                          <TextField
                            value={`${getBackendURL()}/webhooks/evohub/${whatsAppId}`}
                            fullWidth
                            variant="outlined"
                            margin="dense"
                            InputProps={{ readOnly: true }}
                            onFocus={e => e.target.select()}
                          />
                          <Button
                            size="small"
                            onClick={() => {
                              copyToClipboard(
                                `${getBackendURL()}/webhooks/evohub/${whatsAppId}`
                              );
                              toast.success(
                                i18n.t(
                                  "whatsappModal.form.evohubWebhookCopied"
                                )
                              );
                            }}
                          >
                            {i18n.t("whatsappModal.form.copy")}
                          </Button>
                        </div>
                      </div>
                    )}
                  </Paper>
                )}
                <div>
                  <Field
                    as={TextField}
                    label={i18n.t("queueModal.form.greetingMessage")}
                    type="greetingMessage"
                    multiline
                    rows={4}
                    fullWidth
                    name="greetingMessage"
                    spellCheck={true}
                    error={
                      touched.greetingMessage && Boolean(errors.greetingMessage)
                    }
                    helperText={
                      touched.greetingMessage && errors.greetingMessage
                    }
                    variant="outlined"
                    margin="dense"
                  />
                </div>
                <div>
                  <Typography style={{ fontSize: "11px" }}>
                    {`Variaveis: ( {{ms}}=> Turno, 
                  {{name}}=> Nome do contato, 
                  {{protocol}}=> protocolo, {{hora}}=> hora )`}
                  </Typography>
                </div>
                <div>
                  <Field
                    as={TextField}
                    label={i18n.t("queueModal.form.complationMessage")}
                    type="complationMessage"
                    multiline
                    rows={4}
                    fullWidth
                    name="complationMessage"
                    spellCheck={true}
                    error={
                      touched.complationMessage &&
                      Boolean(errors.complationMessage)
                    }
                    helperText={
                      touched.complationMessage && errors.complationMessage
                    }
                    variant="outlined"
                    margin="dense"
                  />
                </div>
                <div>
                  <Field
                    as={TextField}
                    label={i18n.t("queueModal.form.transferMessage")}
                    type="transferMessage"
                    multiline
                    rows={4}
                    fullWidth
                    name="transferMessage"
                    spellCheck={true}
                    error={
                      touched.transferMessage && Boolean(errors.transferMessage)
                    }
                    helperText={
                      touched.transferMessage && errors.transferMessage
                    }
                    variant="outlined"
                    margin="dense"
                  />
                </div>
                <div>
                  <Field
                    as={TextField}
                    label={i18n.t("queueModal.form.outOfHoursMessage")}
                    type="outOfHoursMessage"
                    multiline
                    rows={4}
                    fullWidth
                    name="outOfHoursMessage"
                    spellCheck={true}
                    error={
                      touched.outOfHoursMessage &&
                      Boolean(errors.outOfHoursMessage)
                    }
                    helperText={
                      touched.outOfHoursMessage && errors.outOfHoursMessage
                    }
                    variant="outlined"
                    margin="dense"
                  />
                </div>
                <div>
                  <Field
                    as={TextField}
                    label={i18n.t("queueModal.form.ratingMessage")}
                    type="ratingMessage"
                    multiline
                    rows={4}
                    fullWidth
                    name="ratingMessage"
                    spellCheck={true}
                    error={
                      touched.ratingMessage && Boolean(errors.ratingMessage)
                    }
                    helperText={touched.ratingMessage && errors.ratingMessage}
                    variant="outlined"
                    margin="dense"
                  />
                </div>
                <div>
                  <Field
                    as={TextField}
                    label={i18n.t("queueModal.form.token")}
                    type="token"
                    fullWidth
                    name="token"
                    variant="outlined"
                    margin="dense"
                  />
                </div>
                <QueueSelect
                  selectedQueueIds={selectedQueueIds}
                  onChange={selectedIds => setSelectedQueueIds(selectedIds)}
                />
                <div>
                  <Field
                    as={SelectLanguage}
                    name="language"
                    fullWidth
                    variant="outlined"
                    margin="dense"
                  />
                </div>
              </DialogContent>
              <DialogActions>
                <Button
                  onClick={handleClose}
                  color="secondary"
                  disabled={isSubmitting}
                  variant="outlined"
                >
                  {i18n.t("whatsappModal.buttons.cancel")}
                </Button>
                <Button
                  type="submit"
                  color="primary"
                  disabled={isSubmitting}
                  variant="contained"
                  className={classes.btnWrapper}
                >
                  {whatsAppId
                    ? i18n.t("whatsappModal.buttons.okEdit")
                    : i18n.t("whatsappModal.buttons.okAdd")}
                  {isSubmitting && (
                    <CircularProgress
                      size={24}
                      className={classes.buttonProgress}
                    />
                  )}
                </Button>
              </DialogActions>
            </Form>
          )}
        </Formik>
      </Dialog>
    </div>
  );
};

export default React.memo(WhatsAppModal);
